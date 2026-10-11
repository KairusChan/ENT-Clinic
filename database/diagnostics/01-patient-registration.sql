-- Read-only. Run in the same Supabase project your website uses.
-- Match the staff ID to the user's ID in Authentication > Users.
select id, full_name, role, is_active
from public.staff order by full_name;

select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'patients'
order by policyname;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'patients';

-- SQL Editor does not normally carry the website user's JWT, so auth.uid()
-- or clinic_role() called directly here cannot identify the website user.
