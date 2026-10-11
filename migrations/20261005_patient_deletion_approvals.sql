-- Apply after the patient identity and consultation migrations.
begin;
create or replace function public.patient_name_key(value text)
returns text language sql immutable strict parallel safe
as $$ select lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')) $$;
-- Legacy duplicates must remain available for approved consultation transfers.
-- Keep the unique index when possible; do not make cleanup tools impossible to install.
do $$ begin
    create unique index if not exists patients_name_birthdate_unique
    on public.patients (public.patient_name_key(first_name), public.patient_name_key(last_name), date_of_birth)
    where date_of_birth is not null;
exception when unique_violation then
    raise notice 'Legacy duplicate patients retained. Transfer their consultations, delete duplicates with approval, then create the identity index.';
end $$;
create or replace function public.prevent_new_duplicate_patient()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.date_of_birth is null then return new; end if;
    if TG_OP = 'UPDATE' and row(public.patient_name_key(new.first_name), public.patient_name_key(new.last_name), new.date_of_birth)
        is not distinct from row(public.patient_name_key(old.first_name), public.patient_name_key(old.last_name), old.date_of_birth) then return new; end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(public.patient_name_key(new.first_name), public.patient_name_key(new.last_name), new.date_of_birth)::text, 0));
    if exists (select 1 from public.patients p where p.id <> new.id and p.date_of_birth = new.date_of_birth
        and public.patient_name_key(p.first_name) = public.patient_name_key(new.first_name)
        and public.patient_name_key(p.last_name) = public.patient_name_key(new.last_name)) then
        raise exception 'A patient with these first and last names and birthdate already exists' using errcode = '23505';
    end if;
    return new;
end;
$$;
create trigger patients_prevent_new_duplicates before insert or update of first_name, last_name, date_of_birth
on public.patients for each row execute function public.prevent_new_duplicate_patient();
create table public.patient_deletion_requests (
    id bigint generated always as identity primary key,
    patient_id bigint references public.patients(id) on delete set null,
    patient_label text not null,
    requested_by uuid not null references public.staff(id),
    reason text not null check (length(btrim(reason)) between 1 and 1000),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by uuid references public.staff(id),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz
);
create unique index patient_deletion_pending_unique on public.patient_deletion_requests(patient_id) where status = 'pending';
alter table public.patient_deletion_requests enable row level security;
revoke all on public.patient_deletion_requests from anon, authenticated;
grant select on public.patient_deletion_requests to authenticated;
create policy "Staff read deletion requests" on public.patient_deletion_requests for select to authenticated
using (public.clinic_role() in ('doctor', 'admin') or (public.clinic_role() = 'secretary' and requested_by = auth.uid()));

create or replace function public.find_patient_duplicates(p_first_name text, p_last_name text, p_date_of_birth date)
returns table(id bigint, patient_number text) language sql stable security invoker set search_path = public as $$
    select p.id, p.patient_number::text from public.patients p
    where public.patient_name_key(p.first_name) = public.patient_name_key(p_first_name)
      and public.patient_name_key(p.last_name) = public.patient_name_key(p_last_name)
      and p.date_of_birth = p_date_of_birth;
$$;

create or replace function public.request_patient_deletion(p_patient_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.patients%rowtype; request_id bigint;
begin
    if public.clinic_role() is distinct from 'secretary' then raise exception 'Only an active secretary can request deletion'; end if;
    if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Enter a reason (up to 1000 characters)'; end if;
    select * into p from public.patients where id = p_patient_id for update;
    if not found then raise exception 'Patient record not found'; end if;
    if exists (select 1 from public."Notes" where patient_id = p.id)
       or exists (select 1 from public.visits where patient_id = p.id and status in ('with_doctor', 'completed')) then
        raise exception 'Cannot delete a patient with an active consultation or saved clinical history';
    end if;
    insert into public.patient_deletion_requests(patient_id, patient_label, requested_by, reason)
    values (p.id, concat_ws(' ', p.first_name, p.middle_name, p.last_name, p.suffix) || ' / DOB: ' || coalesce(p.date_of_birth::text, 'unknown') || ' / Patient #' || p.id, auth.uid(), btrim(p_reason))
    on conflict (patient_id) where status = 'pending' do nothing returning id into request_id;
    if request_id is null then select id into request_id from public.patient_deletion_requests where patient_id = p.id and status = 'pending'; end if;
    return request_id;
end;
$$;

create or replace function public.review_patient_deletion(p_request_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.patient_deletion_requests%rowtype;
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can review deletion'; end if;
    if p_approve is null then raise exception 'Choose approve or reject'; end if;
    select * into r from public.patient_deletion_requests where id = p_request_id for update;
    if not found or r.status <> 'pending' then raise exception 'This request has already been reviewed or is unavailable'; end if;
    if p_approve then
        perform 1 from public.patients where id = r.patient_id for update;
        if not found then raise exception 'Patient record no longer exists'; end if;
        if exists (select 1 from public."Notes" where patient_id = r.patient_id)
           or exists (select 1 from public.visits where patient_id = r.patient_id and status in ('with_doctor', 'completed')) then
            raise exception 'Cannot delete a patient with an active consultation or saved clinical history';
        end if;
    end if;
    update public.patient_deletion_requests set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
    if p_approve then delete from public.patients where id = r.patient_id; end if;
end;
$$;

-- Serialize consultation starts with deletion requests; pending review stops new notes.
create or replace function public.guard_patient_deletion_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    perform 1 from public.patients where id = new.patient_id for update;
    if exists (select 1 from public.patient_deletion_requests where patient_id = new.patient_id and status = 'pending') then
        raise exception 'Patient deletion is awaiting doctor approval. Review the request in Patient Lists before continuing.';
    end if;
    return new;
end;
$$;
create trigger visits_guard_patient_deletion before insert or update on public.visits
for each row execute function public.guard_patient_deletion_review();
create trigger notes_guard_patient_deletion before insert or update on public."Notes"
for each row execute function public.guard_patient_deletion_review();
revoke all on function public.request_patient_deletion(bigint,text), public.review_patient_deletion(bigint,boolean), public.find_patient_duplicates(text,text,date) from public, anon;
grant execute on function public.request_patient_deletion(bigint,text), public.review_patient_deletion(bigint,boolean), public.find_patient_duplicates(text,text,date) to authenticated;
commit;
