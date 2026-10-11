-- Allow active secretaries to read saved consultation notes in patient profiles.
-- Editing remains restricted to the assigned doctor through existing RPCs.
begin;
drop policy if exists "Secretaries read consultation notes" on public."Notes";
create policy "Secretaries read consultation notes"
on public."Notes" for select to authenticated
using (public.clinic_role() = 'secretary');
commit;
