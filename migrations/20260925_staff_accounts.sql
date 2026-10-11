begin;
-- Never trust public sign-up metadata for staff permissions.
create or replace function public.create_staff_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
    selected_role text := new.raw_app_meta_data ->> 'role';
    selected_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'New user'), '@', 1));
begin
    if selected_role in ('admin', 'doctor', 'secretary') then
        insert into public.staff (id, full_name, role) values (new.id, selected_name, selected_role);
    end if;
    return new;
end;
$$;
-- Preserve doctor attribution on existing visits.
alter table public.visits drop constraint if exists visits_doctor_id_fkey;
alter table public.visits add constraint visits_doctor_id_fkey
    foreign key (doctor_id) references public.staff(id) on delete restrict;
commit;
