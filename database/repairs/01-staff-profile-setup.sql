-- Repair staff creation in the existing clinic project. Run in Supabase SQL Editor.
-- Preserves registration codes and existing staff. Creates no login accounts.
-- Restores the Auth insert trigger and permits the account service to read profiles.
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
grant usage on schema public to service_role;
grant select, insert, update on public.staff to service_role;
notify pgrst, 'reload schema';
commit;
select t.tgname as trigger_name,
       t.tgenabled as enabled,
       p.proname as function_name
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass
  and t.tgname = 'on_auth_user_created';
