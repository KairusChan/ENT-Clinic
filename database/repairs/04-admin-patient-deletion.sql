-- Apply after the consultation transfer and approval status migrations.
begin;
create or replace function public.review_patient_deletion(p_request_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.patient_deletion_requests%rowtype;
begin
    if coalesce(public.clinic_role(), '') not in ('doctor', 'admin') then raise exception 'Only an active doctor or admin can review deletion'; end if;
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
create or replace function public.admin_delete_patient(p_patient_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare patient public.patients%rowtype; request_id bigint;
begin
    if public.clinic_role() is distinct from 'admin' then raise exception 'Only an active admin can delete patients'; end if;
    if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Enter a deletion reason (up to 1000 characters)'; end if;
    select id into request_id from public.patient_deletion_requests where patient_id=p_patient_id and status='pending' for update;
    select * into patient from public.patients where id=p_patient_id for update;
    if not found then raise exception 'Patient record no longer exists'; end if;
    if request_id is null then
        insert into public.patient_deletion_requests(patient_id,patient_label,requested_by,reason)
        values(patient.id, public.transfer_patient_label(patient), auth.uid(), btrim(p_reason)) returning id into request_id;
    end if;
    perform public.review_patient_deletion(request_id,true);
end;
$$;
revoke all on function public.admin_delete_patient(bigint,text) from public, anon;
grant execute on function public.admin_delete_patient(bigint,text) to authenticated;
notify pgrst, 'reload schema';
commit;
