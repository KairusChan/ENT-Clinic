-- Run AFTER the clinic schema in the target project's Supabase SQL Editor.
-- Results contain one single-use code for each role, valid for 7 days.
-- Rerun this file to generate additional codes; existing codes remain valid.
begin;
create schema if not exists clinic_private;
revoke all on schema clinic_private from public, anon, authenticated;
create table if not exists clinic_private.staff_registration_codes (
    code text primary key default gen_random_uuid()::text,
    role text not null check (role in ('admin','doctor','secretary')),
    expires_at timestamptz not null default now() + interval '7 days'
);
alter table clinic_private.staff_registration_codes enable row level security;
revoke all on clinic_private.staff_registration_codes from public, anon, authenticated;

create or replace function public.create_staff_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
    selected_role text := new.raw_app_meta_data ->> 'role';
    selected_name text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'New user'), '@', 1));
begin
    -- Roles supplied by the existing server-side account manager remain trusted.
    if selected_role is null or selected_role not in ('admin','doctor','secretary') then
        if new.raw_user_meta_data ? 'registration_code' then
            delete from clinic_private.staff_registration_codes
            where code = btrim(new.raw_user_meta_data ->> 'registration_code')
              and role = new.raw_user_meta_data ->> 'role'
              and expires_at > now()
            returning role into selected_role;
            if selected_role is null then
                raise exception 'Invalid, expired or already used registration code';
            end if;
        else
            -- Preserve ordinary Auth creation without granting staff access.
            return new;
        end if;
    end if;
    insert into public.staff(id, full_name, role, is_active)
    values (new.id, selected_name, selected_role, true);
    return new;
end;
$$;
revoke all on function public.create_staff_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_staff_profile();
commit;

insert into clinic_private.staff_registration_codes(role)
values ('admin'), ('doctor'), ('secretary')
returning role, code as registration_code, expires_at;
