-- ENT Clinic database: 02 scheduling and access rules
-- Run after 01-core-schema.sql.

-- Run against the existing Supabase database before deploying the updated pages.
-- Existing patient details and visit history are retained.
begin;
-- Older databases may predate staff activation and admin role helpers.
alter table public.staff add column if not exists is_active boolean not null default true;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.staff
        where id = auth.uid() and role = 'admin' and is_active = true
    );
$$;
create extension if not exists btree_gist with schema extensions;
alter table public.patients add column if not exists suffix text;
alter table public.visits add column if not exists kind text not null default 'appointment' check (kind in ('appointment', 'operation'));
alter table public.visits add column if not exists ends_at timestamptz;
alter table public.visits add column if not exists reminder_minutes integer not null default 15 check (reminder_minutes in (15, 30, 60, 1440));
alter table public.visits drop constraint if exists visits_status_check;
alter table public.visits add constraint visits_status_check check (status in ('scheduled', 'waiting', 'with_doctor', 'completed', 'cancelled'));
alter table public.visits drop constraint if exists visits_schedule_times_check;
alter table public.visits add constraint visits_schedule_times_check check (
    (ends_at is null or ends_at > checked_in_at) and
    (status <> 'scheduled' or (ends_at is not null and doctor_id is not null))
);
-- NULL end times on historical visits are not treated as reserved slots.
alter table public.visits drop constraint if exists visits_doctor_no_overlap;
alter table public.visits add constraint visits_doctor_no_overlap exclude using gist (
    doctor_id with =, tstzrange(checked_in_at, ends_at, '[)') with &&
) where (ends_at is not null and status <> 'cancelled');

create or replace function public.clinic_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.staff where id = auth.uid() and is_active = true $$;

-- Staff may not promote themselves or reactivate their own accounts.
drop policy if exists "Staff can update their own profile" on public.staff;
create policy "Staff can update their own profile" on public.staff for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Staff can read their own profile" on public.staff;
create policy "Staff can read their own profile" on public.staff for select to authenticated
using (id = auth.uid() or public.is_admin() or (public.clinic_role() in ('doctor', 'secretary') and role = 'doctor' and is_active));

-- Replace the original broad policies, so doctor views are read only at the database too.
drop policy if exists "Authenticated users can read patients" on public.patients;
create policy "Authenticated users can read patients" on public.patients for select to authenticated using (public.clinic_role() in ('admin', 'doctor', 'secretary'));
drop policy if exists "Authenticated users can insert patients" on public.patients;
create policy "Authenticated users can insert patients" on public.patients for insert to authenticated with check (public.clinic_role() in ('admin', 'secretary'));
drop policy if exists "Authenticated users can update patients" on public.patients;
create policy "Authenticated users can update patients" on public.patients for update to authenticated using (public.clinic_role() in ('admin', 'secretary')) with check (public.clinic_role() in ('admin', 'secretary'));
drop policy if exists "Authenticated users can delete patients" on public.patients;
create policy "Authenticated users can delete patients" on public.patients for delete to authenticated using (public.is_admin());
drop policy if exists "Authenticated users can read visits" on public.visits;
create policy "Authenticated users can read visits" on public.visits for select to authenticated using (public.clinic_role() in ('admin', 'doctor', 'secretary'));
drop policy if exists "Authenticated users can insert visits" on public.visits;
create policy "Authenticated users can insert visits" on public.visits for insert to authenticated with check (public.clinic_role() in ('admin', 'secretary'));
drop policy if exists "Authenticated users can update visits" on public.visits;
create policy "Authenticated users can update visits" on public.visits for update to authenticated using (public.clinic_role() in ('admin', 'secretary')) with check (public.clinic_role() in ('admin', 'secretary'));
drop policy if exists "Authenticated users can delete visits" on public.visits;
create policy "Authenticated users can delete visits" on public.visits for delete to authenticated using (public.is_admin());

create or replace function public.validate_booking()
returns trigger language plpgsql set search_path = public
as $$
begin
    if new.status = 'scheduled' then
        if not exists (select 1 from public.staff where id = new.doctor_id and role = 'doctor' and is_active) then
            raise exception 'Select an active doctor';
        end if;
        if TG_OP = 'INSERT' then
            if new.checked_in_at <= now() then raise exception 'Choose a future appointment time'; end if;
        elsif new.checked_in_at is distinct from old.checked_in_at and new.checked_in_at <= now() then
            raise exception 'Choose a future appointment time';
        end if;
    end if;
    return new;
end;
$$;
drop trigger if exists visits_validate_booking on public.visits;
create trigger visits_validate_booking before insert or update on public.visits for each row execute function public.validate_booking();
commit;

-- Run after 20260912_scheduling_roles.sql. Existing appointments are retained.
begin;
alter table public.visits drop constraint if exists visits_kind_check;
alter table public.visits add constraint visits_kind_check check (kind in ('appointment', 'operation', 'event'));
alter table public.visits alter column patient_id drop not null;
alter table public.visits drop constraint if exists visits_patient_required;
alter table public.visits add constraint visits_patient_required check (kind = 'event' or patient_id is not null);
alter table public.visits drop constraint if exists visits_event_status_check;
alter table public.visits add constraint visits_event_status_check check (kind <> 'event' or status in ('scheduled', 'completed', 'cancelled'));
commit;

