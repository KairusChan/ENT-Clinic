-- Requires 20261005_patient_deletion_approvals.sql and the consultation migrations.
begin;
create table public.consultation_transfer_requests (
    id bigint generated always as identity primary key,
    source_patient_id bigint references public.patients(id) on delete set null,
    target_patient_id bigint references public.patients(id) on delete set null,
    source_label text not null,
    target_label text not null,
    source_identity jsonb not null,
    target_identity jsonb not null,
    consultation_count integer not null check (consultation_count > 0),
    doctor_ids uuid[] not null,
    reason text not null check (length(btrim(reason)) between 1 and 1000),
    requested_by uuid not null references public.staff(id),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.staff(id),
    reviewed_txid bigint
);
-- Private snapshots are not exposed through the API, including to other doctors.
create table public.consultation_transfer_items (
    request_id bigint not null references public.consultation_transfer_requests(id),
    visit_id bigint not null,
    note_id bigint not null,
    visit_snapshot jsonb not null,
    note_snapshot jsonb not null,
    primary key(request_id, visit_id)
);
create table public.consultation_transfer_approvals (
    request_id bigint not null references public.consultation_transfer_requests(id),
    doctor_id uuid not null references public.staff(id),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_at timestamptz,
    primary key(request_id, doctor_id)
);
create index consultation_transfer_source on public.consultation_transfer_requests(source_patient_id) where status = 'pending';
create index consultation_transfer_target on public.consultation_transfer_requests(target_patient_id) where status = 'pending';
alter table public.consultation_transfer_requests enable row level security;
alter table public.consultation_transfer_items enable row level security;
alter table public.consultation_transfer_approvals enable row level security;
revoke all on public.consultation_transfer_requests, public.consultation_transfer_items, public.consultation_transfer_approvals from anon, authenticated;
grant select on public.consultation_transfer_requests, public.consultation_transfer_approvals to authenticated;
create policy "Read relevant transfer requests" on public.consultation_transfer_requests for select to authenticated
using (public.clinic_role() in ('secretary', 'admin') or (public.clinic_role() = 'doctor' and auth.uid() = any(doctor_ids)));
create policy "Read relevant transfer approvals" on public.consultation_transfer_approvals for select to authenticated
using (exists (select 1 from public.consultation_transfer_requests r where r.id = request_id));

create or replace function public.transfer_patient_identity(p public.patients)
returns jsonb language sql immutable set search_path = public as $$
    select jsonb_build_array(p.first_name, p.middle_name, p.last_name, p.suffix, p.date_of_birth);
$$;
create or replace function public.transfer_patient_label(p public.patients)
returns text language sql immutable set search_path = public as $$
    select concat_ws(' ', p.first_name, p.middle_name, p.last_name, p.suffix)
        || ' / DOB: ' || coalesce(p.date_of_birth::text, 'unknown') || ' / Patient #' || p.id;
$$;

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
    if exists (select 1 from public.patient_deletion_requests where patient_id in (source.id, target.id) and status = 'pending') then
        raise exception 'Resolve pending deletion requests for both patients first';
    end if;
    if exists (select 1 from public.consultation_transfer_requests where status = 'pending'
        and (source_patient_id in (source.id, target.id) or target_patient_id in (source.id, target.id))) then
        raise exception 'One of these patients already has a pending transfer. Resolve that request first';
    end if;
    perform 1 from public.visits where patient_id = source.id order by id for update;
    perform 1 from public."Notes" where patient_id = source.id order by id for update;
    if exists (select 1 from public.visits where patient_id = source.id and status = 'with_doctor') then
        raise exception 'Finish the active consultation before requesting a transfer';
    end if;
    if exists (select 1 from public."Notes" n left join public.visits v on v.id = n.visit_id
        left join public.staff d on d.id = n.doctor_id
        where n.patient_id = source.id and (v.patient_id is distinct from source.id or v.status is distinct from 'completed'
            or v.kind is distinct from 'appointment' or v.doctor_id is distinct from n.doctor_id
            or d.role is distinct from 'doctor' or d.is_active is distinct from true)) then
        raise exception 'All saved consultations must have a completed visit and an active authoring doctor';
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
    if exists (select 1 from public.patient_deletion_requests where patient_id in (source.id, target.id) and status = 'pending') then
        raise exception 'Resolve pending patient deletion requests first';
    end if;
    perform 1 from public.visits where patient_id = source.id order by id for update;
    perform 1 from public."Notes" where patient_id = source.id order by id for update;
    if exists (select 1 from public.visits where patient_id = source.id and status = 'with_doctor') then raise exception 'Finish the active consultation before approving this transfer'; end if;
    if (select count(*) from public."Notes" where patient_id = source.id) <> r.consultation_count
       or exists (select 1 from public.consultation_transfer_items i
            left join public.visits v on v.id = i.visit_id left join public."Notes" n on n.id = i.note_id
            where i.request_id = r.id and (to_jsonb(v) is distinct from i.visit_snapshot or to_jsonb(n) is distinct from i.note_snapshot)) then
        raise exception 'Consultations changed since this request. Reject it and ask the secretary to submit a new one';
    end if;
    if exists (select 1 from public.consultation_transfer_approvals a join public.staff d on d.id = a.doctor_id
        where a.request_id = r.id and (d.role <> 'doctor' or not d.is_active)) then raise exception 'An authoring doctor is inactive. Reject this request'; end if;
    update public.consultation_transfer_approvals set status = 'approved', reviewed_at = now() where request_id = r.id and doctor_id = auth.uid();
    if exists (select 1 from public.consultation_transfer_approvals where request_id = r.id and status <> 'approved') then return 'pending'; end if;
    -- The guard permits only this approved batch inside this transaction, never a client flag.
    update public.consultation_transfer_requests set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), reviewed_txid = txid_current() where id = r.id;
    update public.visits v set patient_id = target.id from public.consultation_transfer_items i where i.request_id = r.id and v.id = i.visit_id;
    update public."Notes" n set patient_id = target.id from public.consultation_transfer_items i where i.request_id = r.id and n.id = i.note_id;
    return 'approved';
end;
$$;

create or replace function public.authorized_consultation_transfer(p_visit_id bigint, p_source bigint, p_target bigint)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.consultation_transfer_requests r join public.consultation_transfer_items i on i.request_id = r.id
        where r.status = 'approved' and r.reviewed_txid = txid_current() and r.reviewed_by = auth.uid()
          and public.clinic_role() = 'doctor' and i.visit_id = p_visit_id and r.source_patient_id = p_source and r.target_patient_id = p_target);
$$;
create or replace function public.guard_consultation_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if exists (select 1 from public."Notes" where visit_id = old.id) then
        if new.patient_id is distinct from old.patient_id
           and (to_jsonb(new) - array['patient_id','updated_at']) = (to_jsonb(old) - array['patient_id','updated_at'])
           and public.authorized_consultation_transfer(old.id, old.patient_id, new.patient_id) then return new; end if;
        if row(new.patient_id,new.doctor_id,new.kind,new.status) is distinct from row(old.patient_id,old.doctor_id,old.kind,'completed'::text) then
            raise exception 'A saved consultation cannot be reopened or reassigned without an approved transfer';
        end if;
    elsif new.kind = 'appointment' and new.status is distinct from old.status then
        if new.status = 'completed' then raise exception 'Save consultation notes to complete this visit'; end if;
        if new.status = 'with_doctor' and (public.clinic_role() is distinct from 'doctor' or new.doctor_id is distinct from auth.uid()) then
            raise exception 'The assigned doctor must accept this patient';
        end if;
    end if;
    return new;
end;
$$;
create or replace function public.guard_note_transfer_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if TG_OP = 'UPDATE' and row(new.patient_id,new.visit_id,new.doctor_id) is distinct from row(old.patient_id,old.visit_id,old.doctor_id) then
        if (to_jsonb(new) - array['patient_id','updated_at']) is distinct from (to_jsonb(old) - array['patient_id','updated_at'])
            or not public.authorized_consultation_transfer(old.visit_id, old.patient_id, new.patient_id) then
            raise exception 'Note identity can only change through an approved consultation transfer';
        end if;
    end if;
    if not exists (select 1 from public.visits v where v.id = new.visit_id and v.patient_id = new.patient_id and v.doctor_id = new.doctor_id) then
        raise exception 'The consultation note must match its visit and doctor';
    end if;
    return new;
end;
$$;
create trigger notes_guard_transfer_identity before insert or update on public."Notes" for each row execute function public.guard_note_transfer_identity();
create or replace function public.guard_pending_transfer_deletion()
returns trigger language plpgsql security definer set search_path = public as $$
declare patient_id bigint;
begin
    if TG_TABLE_NAME = 'patients' then patient_id := old.id; else patient_id := new.patient_id; end if;
    perform 1 from public.patients where id = patient_id for update;
    if exists (select 1 from public.consultation_transfer_requests r where r.status = 'pending' and patient_id in (r.source_patient_id, r.target_patient_id)) then
        raise exception 'Resolve the pending consultation transfer before requesting or approving patient deletion';
    end if;
    if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger patients_guard_transfer_deletion before delete on public.patients for each row execute function public.guard_pending_transfer_deletion();
create trigger deletion_requests_guard_transfer before insert on public.patient_deletion_requests for each row execute function public.guard_pending_transfer_deletion();
revoke all on function public.request_consultation_transfer(bigint,bigint,text), public.review_consultation_transfer(bigint,boolean),
    public.authorized_consultation_transfer(bigint,bigint,bigint), public.transfer_patient_identity(public.patients), public.transfer_patient_label(public.patients) from public, anon, authenticated;
grant execute on function public.request_consultation_transfer(bigint,bigint,text), public.review_consultation_transfer(bigint,boolean) to authenticated;
commit;
