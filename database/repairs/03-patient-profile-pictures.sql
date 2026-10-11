-- Enable profile picture uploads/saves for active admin, doctor and secretary.
-- Run in SQL Editor as postgres after the clinic schema/storage setup.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('PatientRecordUploads', 'PatientRecordUploads', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Replace legacy role policies with the active staff check below.
drop policy if exists "Registration staff upload patient pictures" on storage.objects;
drop policy if exists "Clinic staff read patient pictures" on storage.objects;
create or replace function public.can_manage_patient_pictures()
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.staff
        where id = auth.uid() and is_active = true
          and role in ('admin','doctor','secretary'));
$$;
revoke all on function public.can_manage_patient_pictures() from public, anon;
grant execute on function public.can_manage_patient_pictures() to authenticated;

drop policy if exists "Active staff upload patient profile pictures" on storage.objects;
create policy "Active staff upload patient profile pictures" on storage.objects
for insert to authenticated with check (
    bucket_id = 'PatientRecordUploads'
    and public.can_manage_patient_pictures()
    and name ~ '^records/[0-9a-f-]{36}[.]jpg$'
);
drop policy if exists "Active staff view patient profile pictures" on storage.objects;
create policy "Active staff view patient profile pictures" on storage.objects
for select to authenticated using (
    bucket_id = 'PatientRecordUploads' and public.can_manage_patient_pictures()
);

create or replace function public.save_patient_pictures(
    p_patient_id bigint, p_pictures jsonb, p_expected_updated_at timestamptz
)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare saved_at timestamptz;
begin
    perform 1 from public.staff where id = auth.uid() and is_active = true
        and role in ('admin','doctor','secretary') for share;
    if not found then
        raise exception 'Only active admin, doctor or secretary accounts can save patient pictures.' using errcode = '42501';
    end if;
    if p_pictures is null or jsonb_typeof(p_pictures) <> 'array' then
        raise exception 'Pictures must be an array.';
    end if;
    if jsonb_array_length(p_pictures) > 4 or not public.valid_patient_pictures(p_pictures) then
        raise exception 'Choose up to four valid patient record pictures.';
    end if;
    update public.patients set record_pictures = p_pictures, updated_at = now()
    where id = p_patient_id and updated_at = p_expected_updated_at
    returning updated_at into saved_at;
    if not found then
        raise exception 'This patient was changed elsewhere or is no longer available. Reload the profile before saving pictures.';
    end if;
    return saved_at;
end;
$$;
revoke all on function public.save_patient_pictures(bigint,jsonb,timestamptz) from public, anon;
grant execute on function public.save_patient_pictures(bigint,jsonb,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
