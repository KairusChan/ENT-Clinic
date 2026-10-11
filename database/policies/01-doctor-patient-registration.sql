-- Run in the clinic project's SQL Editor to enable the doctor registration page.
-- Adds insert access only; existing patient update/delete policies are unchanged.
begin;
drop policy if exists "Doctors register patients" on public.patients;
create policy "Doctors register patients" on public.patients
for insert to authenticated with check (public.clinic_role() = 'doctor');

drop policy if exists "Doctors upload patient registration pictures" on storage.objects;
create policy "Doctors upload patient registration pictures" on storage.objects
for insert to authenticated
with check (bucket_id = 'PatientRecordUploads'
    and public.clinic_role() = 'doctor'
    and name ~ '^records/[0-9a-f-]{36}[.]jpg$');
commit;
