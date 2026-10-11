-- Apply after the existing scheduling and consultation migrations.
begin;

-- Doctors can book only their own operations/events. Existing secretary policies remain.
drop policy if exists "Doctors book their own schedule" on public.visits;
create policy "Doctors book their own schedule" on public.visits for insert to authenticated
with check (public.clinic_role() = 'doctor' and doctor_id = auth.uid()
    and kind in ('operation', 'event') and status = 'scheduled');

create or replace function public.manage_schedule_item(p_visit_id bigint, p_expected_status text, p_action text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
    v public.visits%rowtype;
    staff_role text := public.clinic_role();
begin
    if staff_role is null or staff_role not in ('doctor', 'secretary', 'admin') then
        raise exception 'Only active clinic staff can manage schedules';
    end if;
    if p_action is null or p_action not in ('completed', 'delete') then
        raise exception 'Choose Done or Delete';
    end if;
    select * into v from public.visits where id = p_visit_id for update;
    if not found then raise exception 'This schedule no longer exists. Refresh the schedule'; end if;
    if v.kind not in ('operation', 'event') or (staff_role = 'doctor' and v.doctor_id is distinct from auth.uid()) then
        raise exception 'This operation or event is not available to you';
    end if;
    if v.status is distinct from p_expected_status then
        raise exception 'This schedule changed. Refresh before trying again';
    end if;
    if p_action = 'completed' then
        if v.status not in ('scheduled', 'waiting', 'with_doctor') then
            raise exception 'Only an active operation or event can be marked done';
        end if;
        update public.visits set status = 'completed' where id = v.id;
    else
        if exists (select 1 from public."Notes" where visit_id = v.id) then
            raise exception 'This schedule has saved clinical notes and cannot be deleted';
        end if;
        delete from public.visits where id = v.id;
    end if;
    return v.id;
end;
$$;
revoke all on function public.manage_schedule_item(bigint,text,text) from public, anon;
grant execute on function public.manage_schedule_item(bigint,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
