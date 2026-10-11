-- Apply after database/08-workspace-updates.sql.
-- Run after the October 1 schedule actions and appointment notification updates.
-- Operations/events have a start time and remain active until marked Done.
begin;
alter table public.visits drop constraint if exists visits_schedule_times_check;
alter table public.visits add constraint visits_schedule_times_check check (
    (ends_at is null or ends_at > checked_in_at) and
    (status <> 'scheduled' or (doctor_id is not null and (kind in ('operation', 'event') or ends_at is not null)))
);

-- A missing end time is not a duration. Reminders expire 24 hours after the start.
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
        if new.status = 'scheduled' and coalesce(new.ends_at, new.checked_in_at + interval '1 day') > now() then
            insert into public.schedule_push_jobs(visit_id,user_id,category,scheduled_start,run_at,expires_at)
            values(new.id,new.doctor_id,'reminder',new.checked_in_at,greatest(now(),new.checked_in_at-make_interval(mins=>new.reminder_minutes)),coalesce(new.ends_at, new.checked_in_at + interval '1 day'));
        end if;
    end if;
    return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
