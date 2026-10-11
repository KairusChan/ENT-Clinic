-- Run the WHOLE file in the website project's SQL Editor as postgres.
-- Checks trusted staff records directly; does not depend on clinic_role().
-- Does not change staff roles, activate accounts, or remove custom policies.
begin;

create or replace function public.can_register_patient()
returns boolean language sql stable security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff s
        where s.id = auth.uid()
          and s.is_active = true
          and s.role in ('admin', 'doctor', 'secretary')
    );
$$;
revoke all on function public.can_register_patient() from public, anon;
grant execute on function public.can_register_patient() to authenticated;

drop policy if exists "Active clinic staff register patients" on public.patients;
create policy "Active clinic staff register patients"
on public.patients for insert to authenticated
with check (public.can_register_patient());

notify pgrst, 'reload schema';
commit;

-- Expected: new INSERT policy listed. Any restrictive INSERT/ALL policy
-- still applies; inspect its condition if registration continues to fail.
select policyname, cmd, permissive, roles, with_check
from pg_policies
where schemaname = 'public' and tablename = 'patients'
  and cmd in ('INSERT', 'ALL')
order by policyname;
