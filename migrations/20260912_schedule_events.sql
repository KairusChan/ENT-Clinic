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
