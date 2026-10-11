-- October 1 workspace update. Run after database/01 through 07.
-- Existing installations can run this file instead of the two 20261001 migrations.
-- For closed-app appointment push, also deploy supabase/functions/send-schedule-push.

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

-- Apply after 20260912_android_push.sql (or database/03-notifications.sql).
begin;
create or replace function public.enqueue_schedule_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if TG_OP = 'UPDATE' and row(new.kind,new.doctor_id,new.checked_in_at,new.ends_at,new.status,new.reason,new.clinic_location,new.reminder_minutes,new.patient_id)
        is not distinct from row(old.kind,old.doctor_id,old.checked_in_at,old.ends_at,old.status,old.reason,old.clinic_location,old.reminder_minutes,old.patient_id) then return new; end if;
    delete from public.schedule_push_jobs where visit_id = new.id and finished_at is null;
    if new.doctor_id is null then return new; end if;
    if new.kind = 'appointment' then
        if new.status in ('waiting', 'scheduled') then
            if TG_OP = 'INSERT' or new.doctor_id is distinct from old.doctor_id or new.status is distinct from old.status then
                insert into public.schedule_push_jobs(visit_id,user_id,category,scheduled_start,run_at,expires_at)
                values(new.id,new.doctor_id,'change',new.checked_in_at,now(),now()+interval '1 day');
            end if;
        end if;
    elsif new.kind in ('operation', 'event') then
        insert into public.schedule_push_jobs(visit_id,user_id,category,scheduled_start,run_at,expires_at)
        values(new.id,new.doctor_id,'change',new.checked_in_at,now(),now()+interval '1 day');
        if new.status = 'scheduled' and new.ends_at > now() then
            insert into public.schedule_push_jobs(visit_id,user_id,category,scheduled_start,run_at,expires_at)
            values(new.id,new.doctor_id,'reminder',new.checked_in_at,greatest(now(),new.checked_in_at-make_interval(mins=>new.reminder_minutes)),new.ends_at);
        end if;
    end if;
    return new;
end;
$$;
commit;
