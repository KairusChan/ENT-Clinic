-- Apply after 20261006_consultation_transfers.sql. Overrides are limited to approved RPC transactions.
begin;
alter table public.patient_deletion_requests add column if not exists resolution_reason text;
alter table public.consultation_transfer_requests add column if not exists resolution_reason text;

create or replace function public.request_consultation_transfer(p_source_patient_id bigint, p_target_patient_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare source public.patients%rowtype; target public.patients%rowtype; request_id bigint; doctor_ids uuid[]; total integer;
begin
    if public.clinic_role() is distinct from 'secretary' then raise exception 'Only an active secretary can request a consultation transfer'; end if;
    if p_source_patient_id is null or p_target_patient_id is null or p_source_patient_id = p_target_patient_id then raise exception 'Choose a different destination patient'; end if;
    if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Enter a reason (up to 1000 characters)'; end if;
    perform 1 from public.patients where id in (p_source_patient_id, p_target_patient_id) order by id for update;
    select * into source from public.patients where id = p_source_patient_id;
    if not found then raise exception 'Source patient no longer exists'; end if;
    select * into target from public.patients where id = p_target_patient_id;
    if not found then raise exception 'Destination patient no longer exists'; end if;
    if exists (select 1 from public.consultation_transfer_requests where status = 'pending'
        and (source_patient_id in (source.id, target.id) or target_patient_id in (source.id, target.id))) then
        raise exception 'One of these patients already has a pending transfer. Resolve that request first';
    end if;
    perform 1 from public.visits where patient_id = source.id order by id for update;
    perform 1 from public."Notes" where patient_id = source.id order by id for update;
    if exists (select 1 from public."Notes" n left join public.visits v on v.id = n.visit_id
        left join public.staff d on d.id = n.doctor_id
        where n.patient_id = source.id and (v.patient_id is distinct from source.id
            or v.kind is distinct from 'appointment' or v.doctor_id is distinct from n.doctor_id
            or d.role is distinct from 'doctor' or d.is_active is distinct from true)) then
        raise exception 'All saved consultations must have a matching visit and an active authoring doctor';
    end if;
    select count(*), array_agg(distinct n.doctor_id) into total, doctor_ids from public."Notes" n where n.patient_id = source.id;
    if total = 0 then raise exception 'This patient has no saved consultations to transfer'; end if;
    insert into public.consultation_transfer_requests(source_patient_id, target_patient_id, source_label, target_label,
        source_identity, target_identity, consultation_count, doctor_ids, reason, requested_by)
    values (source.id, target.id, public.transfer_patient_label(source), public.transfer_patient_label(target),
        public.transfer_patient_identity(source), public.transfer_patient_identity(target), total, doctor_ids, btrim(p_reason), auth.uid()) returning id into request_id;
    insert into public.consultation_transfer_items(request_id, visit_id, note_id, visit_snapshot, note_snapshot)
    select request_id, v.id, n.id, to_jsonb(v), to_jsonb(n) from public."Notes" n join public.visits v on v.id = n.visit_id where n.patient_id = source.id;
    insert into public.consultation_transfer_approvals(request_id, doctor_id) select request_id, unnest(doctor_ids);
    return request_id;
end;
$$;

create or replace function public.review_consultation_transfer(p_request_id bigint, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare r public.consultation_transfer_requests%rowtype; source public.patients%rowtype; target public.patients%rowtype;
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can review a transfer'; end if;
    if p_approve is null then raise exception 'Choose approve or reject'; end if;
    select * into r from public.consultation_transfer_requests where id = p_request_id for update;
    if not found or not (auth.uid() = any(r.doctor_ids)) then raise exception 'This transfer is not assigned to you'; end if;
    if r.status <> 'pending' then raise exception 'This transfer has already been reviewed'; end if;
    if not p_approve then
        update public.consultation_transfer_approvals set status = 'rejected', reviewed_at = now() where request_id = r.id and doctor_id = auth.uid();
        update public.consultation_transfer_requests set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid() where id = r.id;
        return 'rejected';
    end if;
    perform 1 from public.patients where id in (r.source_patient_id, r.target_patient_id) order by id for update;
    select * into source from public.patients where id = r.source_patient_id;
    if not found then raise exception 'Source patient no longer exists. Reject this request'; end if;
    select * into target from public.patients where id = r.target_patient_id;
    if not found then raise exception 'Destination patient no longer exists. Reject this request'; end if;
    if public.transfer_patient_identity(source) is distinct from r.source_identity or public.transfer_patient_identity(target) is distinct from r.target_identity then
        raise exception 'Patient identity changed. Reject this request and ask the secretary to submit a new one';
    end if;
    perform 1 from public.visits where patient_id = source.id order by id for update;
    perform 1 from public."Notes" where patient_id = source.id order by id for update;
    if (select count(*) from public."Notes" where patient_id = source.id) <> r.consultation_count
       or exists (select 1 from public.consultation_transfer_items i
            left join public.visits v on v.id = i.visit_id left join public."Notes" n on n.id = i.note_id
            where i.request_id = r.id and ((to_jsonb(v) - array['status','updated_at']) is distinct from (i.visit_snapshot - array['status','updated_at']) or to_jsonb(n) is distinct from i.note_snapshot)) then
        raise exception 'Consultations changed since this request. Reject it and ask the secretary to submit a new one';
    end if;
    if exists (select 1 from public.consultation_transfer_approvals a join public.staff d on d.id = a.doctor_id
        where a.request_id = r.id and (d.role <> 'doctor' or not d.is_active)) then raise exception 'An authoring doctor is inactive. Reject this request'; end if;
    update public.consultation_transfer_approvals set status = 'approved', reviewed_at = now() where request_id = r.id and doctor_id = auth.uid();
    if exists (select 1 from public.consultation_transfer_approvals where request_id = r.id and status <> 'approved') then return 'pending'; end if;
    -- The guard permits only this approved batch inside this transaction, never a client flag.
    update public.consultation_transfer_requests set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), reviewed_txid = txid_current() where id = r.id;
    -- Incoming consultations make an older destination deletion request obsolete.
    update public.patient_deletion_requests set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
        resolution_reason = 'Superseded by approved consultation transfer #' || r.id
    where patient_id = target.id and status = 'pending';
    update public.visits v set patient_id = target.id from public.consultation_transfer_items i where i.request_id = r.id and v.id = i.visit_id;
    update public."Notes" n set patient_id = target.id from public.consultation_transfer_items i where i.request_id = r.id and n.id = i.note_id;
    return 'approved';
end;
$$;

create or replace function public.request_patient_deletion(p_patient_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.patients%rowtype; request_id bigint;
begin
    if public.clinic_role() is distinct from 'secretary' then raise exception 'Only an active secretary can request deletion'; end if;
    if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Enter a reason (up to 1000 characters)'; end if;
    select * into p from public.patients where id = p_patient_id for update;
    if not found then raise exception 'Patient record not found'; end if;
    -- A request may coexist with notes/active visits; approval checks the current notes.
    insert into public.patient_deletion_requests(patient_id, patient_label, requested_by, reason)
    values (p.id, public.transfer_patient_label(p), auth.uid(), btrim(p_reason))
    on conflict (patient_id) where status = 'pending' do nothing returning id into request_id;
    if request_id is null then select id into request_id from public.patient_deletion_requests where patient_id = p.id and status = 'pending'; end if;
    return request_id;
end;
$$;

create or replace function public.review_patient_deletion(p_request_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.patient_deletion_requests%rowtype;
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can review deletion'; end if;
    if p_approve is null then raise exception 'Choose approve or reject'; end if;
    select * into r from public.patient_deletion_requests where id = p_request_id for update;
    if not found or r.status <> 'pending' then raise exception 'This request has already been reviewed or is unavailable'; end if;
    if p_approve then
        perform 1 from public.patients where id = r.patient_id for update;
        if not found then raise exception 'Patient record no longer exists'; end if;
        if exists (select 1 from public."Notes" where patient_id = r.patient_id)
           or exists (select 1 from public."Notes" n join public.visits v on v.id=n.visit_id where v.patient_id=r.patient_id) then
            raise exception 'Transfer the saved consultation notes before approving patient deletion';
        end if;
        -- The approving doctor closes conflicting transfer requests, with an audit reason.
        update public.consultation_transfer_requests set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
            resolution_reason = 'Superseded by approved patient deletion #' || r.id
        where status = 'pending' and r.patient_id in (source_patient_id, target_patient_id);
        update public.consultation_transfer_approvals a set status = 'rejected', reviewed_at = now()
        from public.consultation_transfer_requests t where a.request_id=t.id and a.status='pending'
            and t.resolution_reason = 'Superseded by approved patient deletion #' || r.id;
    end if;
    update public.patient_deletion_requests set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
    if p_approve then delete from public.patients where id = r.patient_id; end if;
end;
$$;

create or replace function public.guard_pending_transfer_deletion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    -- Secretaries may request deletion while a transfer awaits approval.
    -- Only the doctor review RPC resolves conflicting requests before the actual delete.
    if TG_OP <> 'DELETE' then return new; end if;
    if exists (select 1 from public.consultation_transfer_requests r where r.status = 'pending'
        and old.id in (r.source_patient_id, r.target_patient_id)) then
        raise exception 'Use doctor-approved patient deletion to resolve the pending consultation transfer';
    end if;
    return old;
end;
$$;

create or replace function public.guard_patient_deletion_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare visit_id bigint;
begin
    -- No session flag or general permission bypass: only the approved batch in this transaction.
    if TG_OP = 'UPDATE' and new.patient_id is distinct from old.patient_id then
        if TG_TABLE_NAME = 'visits' then visit_id := old.id; else visit_id := old.visit_id; end if;
        if public.authorized_consultation_transfer(visit_id, old.patient_id, new.patient_id) then return new; end if;
    end if;
    perform 1 from public.patients where id = new.patient_id for update;
    if exists (select 1 from public.patient_deletion_requests where patient_id = new.patient_id and status = 'pending') then
        raise exception 'Patient deletion is awaiting doctor approval. Review the request in Patient Lists before continuing.';
    end if;
    return new;
end;
$$;
revoke all on function public.request_patient_deletion(bigint,text), public.review_patient_deletion(bigint,boolean),
    public.request_consultation_transfer(bigint,bigint,text), public.review_consultation_transfer(bigint,boolean) from public, anon;
grant execute on function public.request_patient_deletion(bigint,text), public.review_patient_deletion(bigint,boolean),
    public.request_consultation_transfer(bigint,bigint,text), public.review_consultation_transfer(bigint,boolean) to authenticated;
commit;
