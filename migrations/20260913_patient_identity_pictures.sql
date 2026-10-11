-- Run after the existing migrations. If duplicate identities exist, this transaction
-- stops without changing records. Review them before retrying; never auto-delete patients.
begin;
create or replace function public.patient_name_key(value text)
returns text language sql immutable strict parallel safe
as $$ select lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')) $$;

create unique index if not exists patients_name_birthdate_unique
on public.patients (public.patient_name_key(first_name), public.patient_name_key(last_name), date_of_birth)
where date_of_birth is not null;

alter table public.patients add column if not exists record_pictures jsonb not null default '[]'::jsonb;
create or replace function public.valid_patient_pictures(pictures jsonb)
returns boolean language plpgsql immutable as $$
declare picture jsonb;
begin
    if jsonb_typeof(pictures) <> 'array' then return false; end if;
    if jsonb_array_length(pictures) > 4 then return false; end if;
    for picture in select value from jsonb_array_elements(pictures) loop
        if jsonb_typeof(picture) <> 'string' or length(picture #>> '{}') > 1500000
           or (picture #>> '{}') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
    end loop;
    return true;
end;
$$;
alter table public.patients add constraint patients_record_pictures_valid check (public.valid_patient_pictures(record_pictures));

create or replace function public.validate_patient_identity()
returns trigger language plpgsql as $$
begin
    if btrim(new.first_name) = '' or btrim(new.last_name) = '' then
        raise exception 'First and last names are required';
    end if;
    if TG_OP = 'INSERT' and new.date_of_birth is null then
        raise exception 'Date of birth is required';
    end if;
    if new.date_of_birth > current_date then raise exception 'Date of birth cannot be in the future'; end if;
    return new;
end;
$$;
create trigger patients_validate_identity before insert or update of first_name, last_name, date_of_birth
on public.patients for each row execute function public.validate_patient_identity();
commit;
