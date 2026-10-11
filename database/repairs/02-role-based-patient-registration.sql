-- Run as postgres in Supabase SQL Editor, then upload the updated website files.
-- Authorization uses the signed-in Auth UID and trusted public.staff role.
-- The caller cannot supply an acting user ID or role. RLS remains enabled.
begin;
create or replace function public.register_patient(p_patient jsonb)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
    actor_role text;
    actor_active boolean;
    patient_id bigint;
    birthdate date;
    field_name text;
begin
    if auth.uid() is null then
        raise exception 'Sign out and sign in again before registering a patient.' using errcode = '42501';
    end if;
    select s.role, s.is_active into actor_role, actor_active
    from public.staff s where s.id = auth.uid() for share;
    if not found then
        raise exception 'This login has no staff profile in this project. Ask your administrator to link the correct Authentication user ID.' using errcode = '42501';
    end if;
    if actor_active is distinct from true or actor_role is null or actor_role not in ('admin','doctor','secretary') then
        raise exception 'Only active admin, doctor or secretary accounts can register patients.' using errcode = '42501';
    end if;
    if p_patient is null or jsonb_typeof(p_patient) <> 'object' then
        raise exception 'Patient details must be an object.';
    end if;
    for field_name in select jsonb_object_keys(p_patient) loop
        if field_name not in ('first_name','last_name','middle_name','suffix','date_of_birth','sex','phone','address','record_pictures') then
            raise exception 'Unsupported patient field: %', field_name;
        end if;
        if field_name <> 'record_pictures' and jsonb_typeof(p_patient -> field_name) <> 'string' then
            raise exception 'Patient field must be text: %', field_name;
        end if;
    end loop;
    if coalesce(btrim(p_patient ->> 'first_name'),'') = ''
       or coalesce(btrim(p_patient ->> 'last_name'),'') = ''
       or coalesce(p_patient ->> 'date_of_birth','') = '' then
        raise exception 'First name, last name and date of birth are required.';
    end if;
    birthdate := (p_patient ->> 'date_of_birth')::date;
    if birthdate > (now() at time zone 'Asia/Singapore')::date then
        raise exception 'Date of birth cannot be in the future.';
    end if;
    if p_patient ? 'record_pictures' and jsonb_typeof(p_patient -> 'record_pictures') <> 'array' then
        raise exception 'Patient pictures must be an array.';
    end if;
    -- Existing identity/picture constraints and duplicate-prevention triggers apply.
    insert into public.patients (
        first_name, last_name, middle_name, suffix, date_of_birth,
        sex, phone, address, record_pictures
    ) values (
        regexp_replace(btrim(p_patient ->> 'first_name'), '[[:space:]]+', ' ', 'g'),
        regexp_replace(btrim(p_patient ->> 'last_name'), '[[:space:]]+', ' ', 'g'),
        nullif(regexp_replace(btrim(p_patient ->> 'middle_name'), '[[:space:]]+', ' ', 'g'), ''),
        nullif(btrim(p_patient ->> 'suffix'), ''), birthdate,
        nullif(p_patient ->> 'sex', ''), nullif(btrim(p_patient ->> 'phone'), ''),
        nullif(btrim(p_patient ->> 'address'), ''), coalesce(p_patient -> 'record_pictures', '[]'::jsonb)
    ) returning id into patient_id;
    return patient_id;
end;
$$;
revoke all on function public.register_patient(jsonb) from public, anon;
grant execute on function public.register_patient(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
