-- SQL Editor: permits the server-side manage-staff function to save staff profiles.
-- These are database grants, not RLS policies. Never grant these to anon.
begin;
grant usage on schema public to service_role;
grant select, insert, update on public.staff to service_role;
notify pgrst, 'reload schema';
commit;
