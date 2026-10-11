-- Run in Supabase SQL Editor after the patient identity/pictures migration.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('PatientRecordUploads', 'PatientRecordUploads', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clinic staff read patient pictures" on storage.objects;
create policy "Clinic staff read patient pictures" on storage.objects for select to authenticated
using (bucket_id = 'PatientRecordUploads' and public.clinic_role() in ('admin', 'doctor', 'secretary'));
drop policy if exists "Registration staff upload patient pictures" on storage.objects;
create policy "Registration staff upload patient pictures" on storage.objects for insert to authenticated
with check (bucket_id = 'PatientRecordUploads' and public.clinic_role() in ('admin', 'secretary')
    and name ~ '^records/[0-9a-f-]{36}[.]jpg$');

-- Keep existing embedded photos readable while new uploads use object paths.
create or replace function public.valid_patient_pictures(pictures jsonb)
returns boolean language plpgsql immutable as $$
declare picture jsonb; value text;
begin
    if jsonb_typeof(pictures) <> 'array' then return false; end if;
    if jsonb_array_length(pictures) > 4 then return false; end if;
    for picture in select * from jsonb_array_elements(pictures) loop
        value := picture #>> '{}';
        if jsonb_typeof(picture) <> 'string' or length(value) > 1500000 then return false; end if;
        if value !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
           and value !~ '^records/[0-9a-f-]{36}[.]jpg$' then return false; end if;
    end loop;
    return true;
end;
$$;
commit;
