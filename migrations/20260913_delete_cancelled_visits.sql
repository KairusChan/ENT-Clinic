-- Cancellation permanently deletes the visit/schedule, not the patient.
-- Run after the consultation notes migrations.
begin;
create or replace function public.cancel_visit(p_visit_id bigint, p_expected_status text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v public.visits%rowtype;
begin
    if public.clinic_role() is null or public.clinic_role() not in ('secretary', 'admin') then
        raise exception 'Only a secretary or administrator can cancel a visit';
    end if;
    if p_expected_status is null or p_expected_status not in ('waiting', 'scheduled') then
        raise exception 'Only waiting or scheduled visits can be cancelled';
    end if;
    select * into v from public.visits where id = p_visit_id for update;
    if not found then return p_visit_id; end if;
    if v.status is distinct from p_expected_status then
        raise exception 'This visit has changed. Refresh the queue or schedule before cancelling';
    end if;
    -- The Notes foreign key also prevents deleting a visit with saved clinical notes.
    delete from public.visits where id = v.id;
    return v.id;
end;
$$;
revoke all on function public.cancel_visit(bigint,text) from public, anon;
grant execute on function public.cancel_visit(bigint,text) to authenticated;

-- Remove existing cancelled visits. Linked push jobs are removed by their FK cascade.
-- If a cancelled visit has saved Notes, its restrictive FK stops this transaction.
delete from public.visits where status = 'cancelled';
notify pgrst, 'reload schema';
commit;
