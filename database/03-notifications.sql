-- ENT Clinic database: 03 realtime and Android push notifications
-- Run after 02-scheduling.sql.

-- Run after the scheduling and event migrations. Enables live schedule updates.
begin;
do $$
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'visits') then
        alter publication supabase_realtime add table public.visits;
    end if;
end;
$$;
commit;

-- Requires all previous scheduling migrations. Never expose service_role credentials to the app.
begin;
create table if not exists public.push_devices (
    token text primary key,
    user_id uuid not null references public.staff(id) on delete cascade,
    updated_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
drop policy if exists "Doctors manage their own push devices" on public.push_devices;
create policy "Doctors manage their own push devices" on public.push_devices for all to authenticated
using (user_id = auth.uid() and public.clinic_role() = 'doctor')
with check (user_id = auth.uid() and public.clinic_role() = 'doctor');
grant select, insert, update, delete on public.push_devices to authenticated;
create index if not exists push_devices_user_idx on public.push_devices(user_id);
create table if not exists public.schedule_push_jobs (
    id bigint generated always as identity primary key,
    visit_id bigint not null references public.visits(id) on delete cascade,
    user_id uuid not null references public.staff(id) on delete cascade,
    category text not null check (category in ('change','reminder')),
    scheduled_start timestamptz not null,
    run_at timestamptz not null,
    expires_at timestamptz not null,
    attempts integer not null default 0,
    locked_until timestamptz,
    sent_tokens text[] not null default '{}',
    finished_at timestamptz
);
alter table public.schedule_push_jobs enable row level security;
grant all on public.push_devices, public.schedule_push_jobs to service_role;
grant usage, select on sequence public.schedule_push_jobs_id_seq to service_role;
-- No authenticated policies: only the server's service role can access jobs.
create index if not exists schedule_push_due_idx on public.schedule_push_jobs(run_at) where finished_at is null;
create or replace function public.enqueue_schedule_push()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    if TG_OP = 'UPDATE' and row(new.kind,new.doctor_id,new.checked_in_at,new.ends_at,new.status,new.reason,new.clinic_location,new.reminder_minutes,new.patient_id)
        is not distinct from row(old.kind,old.doctor_id,old.checked_in_at,old.ends_at,old.status,old.reason,old.clinic_location,old.reminder_minutes,old.patient_id) then return new; end if;
    -- Superseded reminders and unsent changes are invalidated on edits or cancellations.
    delete from public.schedule_push_jobs where visit_id = new.id and finished_at is null;
    if new.kind in ('operation','event') and new.doctor_id is not null then
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
drop trigger if exists visits_enqueue_schedule_push on public.visits;
create trigger visits_enqueue_schedule_push after insert or update on public.visits for each row execute function public.enqueue_schedule_push();
create or replace function public.claim_schedule_push_jobs()
returns setof public.schedule_push_jobs language sql security definer set search_path = public
as $$
    update public.schedule_push_jobs set locked_until = now()+interval '5 minutes', attempts = attempts+1
    where id in (
        select id from public.schedule_push_jobs
        where finished_at is null and run_at <= now() and expires_at > now() and attempts < 8
          and (locked_until is null or locked_until < now())
        order by run_at for update skip locked limit 10
    ) returning *;
$$;
revoke all on function public.claim_schedule_push_jobs() from public, anon, authenticated;
grant execute on function public.claim_schedule_push_jobs() to service_role;
revoke all on public.schedule_push_jobs from anon, authenticated;
-- Backfill upcoming operations/events, without generating historical change alerts.
insert into public.schedule_push_jobs(visit_id,user_id,category,scheduled_start,run_at,expires_at)
select v.id,v.doctor_id,'reminder',v.checked_in_at,greatest(now(),v.checked_in_at-make_interval(mins=>v.reminder_minutes)),v.ends_at
from public.visits v where v.kind in ('operation','event') and v.status='scheduled' and v.doctor_id is not null and v.ends_at > now()
and not exists(select 1 from public.schedule_push_jobs j where j.visit_id=v.id and j.category='reminder' and j.scheduled_start=v.checked_in_at);
commit;


-- Optional Supabase Cron setup. Run only after configuring Vault secrets.
-- See the comments in supabase/schedule-push-cron.sql for required secrets.
-- Optional: run only after deploying send-schedule-push and enabling pg_cron/pg_net.
-- First create these secrets in Supabase Vault using the Dashboard:
-- schedule_push_url = https://YOUR_PROJECT.supabase.co/functions/v1/send-schedule-push
-- schedule_push_cron_secret = the same SCHEDULE_PUSH_CRON_SECRET used by the Edge Function.
-- Never put the Firebase private key in this SQL or in web assets.
select cron.schedule(
    'ent-schedule-push-every-minute',
    '* * * * *',
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'schedule_push_url'),
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'schedule_push_cron_secret')),
        body := '{}'::jsonb
    );
    $$
);
