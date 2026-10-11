-- Read-only checks for the Auth-to-staff trigger and server permissions.
select t.tgname as trigger_name, t.tgenabled as enabled,
       p.proname as function_name
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

select has_schema_privilege('service_role', 'public', 'USAGE') as schema_access,
       has_table_privilege('service_role', 'public.staff', 'SELECT') as can_read,
       has_table_privilege('service_role', 'public.staff', 'INSERT') as can_insert,
       has_table_privilege('service_role', 'public.staff', 'UPDATE') as can_update;

select u.id, s.full_name, s.role, s.is_active,
       u.raw_app_meta_data ->> 'role' as server_assigned_role,
       s.id is not null as has_staff_profile
from auth.users u left join public.staff s on s.id = u.id
order by u.created_at desc;
