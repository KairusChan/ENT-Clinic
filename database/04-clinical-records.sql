-- ENT Clinic database: 04 patient records and consultations
-- Run after 03-notifications.sql.

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

-- Run after the existing scheduling/role migrations. Preserves existing visits.
begin;
create table if not exists public."Notes" (
    id bigint generated always as identity primary key,
    visit_id bigint not null unique references public.visits(id) on delete restrict,
    patient_id bigint not null references public.patients(id) on delete restrict,
    doctor_id uuid not null references public.staff(id) on delete restrict,
    subjective text not null default '',
    objective text not null default '',
    history text not null default '',
    assessment text not null default '',
    plan text not null default '',
    rx text not null default '',
    referral text not null default '',
    recommendation text not null default '',
    admitting_orders text not null default '',
    pf text not null default '',
    diagnostic text not null default '',
    created_at timestamptz not null default now(),
    constraint notes_not_empty check (length(btrim(subjective || objective || history || assessment || plan || rx || referral || recommendation || admitting_orders || pf || diagnostic)) > 0)
);
create index if not exists notes_patient_idx on public."Notes" (patient_id);
alter table public."Notes" enable row level security;
revoke all on public."Notes" from anon, authenticated;
grant select on public."Notes" to authenticated;
grant all on public."Notes" to service_role;
grant usage, select on sequence public."Notes_id_seq" to service_role;
drop policy if exists "Doctors read their consultation notes" on public."Notes";
create policy "Doctors read their consultation notes" on public."Notes" for select to authenticated
using ((public.clinic_role() = 'doctor' and doctor_id = auth.uid()) or public.is_admin());

create or replace function public.accept_consultation(p_visit_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v public.visits%rowtype;
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can accept a patient'; end if;
    select * into v from public.visits where id = p_visit_id for update;
    if not found or v.doctor_id is distinct from auth.uid() or v.kind <> 'appointment' then
        raise exception 'This consultation is not assigned to you';
    end if;
    if v.status not in ('waiting', 'with_doctor') then raise exception 'This patient is no longer waiting for consultation'; end if;
    if v.status = 'waiting' then update public.visits set status = 'with_doctor' where id = v.id; end if;
    return v.id;
end;
$$;

create or replace function public.save_consultation_notes(p_visit_id bigint, p_notes jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
    v public.visits%rowtype;
    existing public."Notes"%rowtype;
    note_id bigint;
    field_name text;
    normalized jsonb := '{}'::jsonb;
    fields text[] := array['subjective','objective','history','assessment','plan','rx','referral','recommendation','admitting_orders','pf','diagnostic'];
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can save consultation notes'; end if;
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' then raise exception 'Notes must be an object'; end if;
    foreach field_name in array fields loop
        if p_notes ? field_name and jsonb_typeof(p_notes -> field_name) <> 'string' then raise exception 'Note fields must be text'; end if;
        if length(coalesce(p_notes ->> field_name, '')) > 20000 then raise exception 'Each note field must be at most 20000 characters'; end if;
        normalized := normalized || jsonb_build_object(field_name, btrim(coalesce(p_notes ->> field_name, '')));
    end loop;
    if not exists (select 1 from jsonb_each_text(normalized) where value <> '') then raise exception 'Enter consultation notes before saving'; end if;
    select * into v from public.visits where id = p_visit_id for update;
    if not found or v.doctor_id is distinct from auth.uid() or v.kind <> 'appointment' then raise exception 'This consultation is not assigned to you'; end if;
    select * into existing from public."Notes" where visit_id = v.id;
    if found then
        -- A retry after a lost response succeeds, but a second tab cannot overwrite a saved note.
        if existing.doctor_id = auth.uid() and v.status = 'completed' and
            (to_jsonb(existing) - array['id','visit_id','patient_id','doctor_id','created_at']) = normalized then return existing.id; end if;
        raise exception 'Notes have already been saved. Reopen the consultation to view them';
    end if;
    if v.status <> 'with_doctor' then raise exception 'Accept this patient before saving consultation notes'; end if;
    insert into public."Notes" (visit_id, patient_id, doctor_id, subjective, objective, history, assessment, plan, rx, referral, recommendation, admitting_orders, pf, diagnostic)
    values (v.id, v.patient_id, auth.uid(), normalized->>'subjective', normalized->>'objective', normalized->>'history',
        normalized->>'assessment', normalized->>'plan', normalized->>'rx', normalized->>'referral', normalized->>'recommendation', normalized->>'admitting_orders', normalized->>'pf', normalized->>'diagnostic')
    returning id into note_id;
    update public.visits set status = 'completed' where id = v.id;
    return note_id;
end;
$$;

-- Keep visit identity and completed notes together, and prevent skipping the consultation flow.
create or replace function public.guard_consultation_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if exists (select 1 from public."Notes" where visit_id = old.id) then
        if row(new.patient_id,new.doctor_id,new.kind,new.status) is distinct from row(old.patient_id,old.doctor_id,old.kind,'completed'::text) then
            raise exception 'A saved consultation cannot be reopened or reassigned';
        end if;
    elsif new.kind = 'appointment' and new.status is distinct from old.status then
        if new.status = 'completed' then raise exception 'Save consultation notes to complete this visit'; end if;
        if new.status = 'with_doctor' and (public.clinic_role() is distinct from 'doctor' or new.doctor_id is distinct from auth.uid()) then
            raise exception 'The assigned doctor must accept this patient';
        end if;
    end if;
    return new;
end;
$$;
drop trigger if exists visits_guard_consultation on public.visits;
create trigger visits_guard_consultation before update on public.visits for each row execute function public.guard_consultation_workflow();
revoke all on function public.accept_consultation(bigint), public.save_consultation_notes(bigint,jsonb) from public, anon;
grant execute on function public.accept_consultation(bigint), public.save_consultation_notes(bigint,jsonb) to authenticated;
commit;

-- Run after 20260913_consultation_notes.sql. Allows the assigned doctor to edit saved notes.
begin;
create or replace function public.update_consultation_notes(p_visit_id bigint, p_notes jsonb, p_expected_notes jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
    v public.visits%rowtype;
    saved public."Notes"%rowtype;
    current_notes jsonb;
    normalized jsonb := '{}'::jsonb;
    field_name text;
    fields text[] := array['subjective','objective','history','assessment','plan','rx','referral','recommendation','admitting_orders','pf','diagnostic'];
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can edit consultation notes'; end if;
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' then raise exception 'Notes must be an object'; end if;
    foreach field_name in array fields loop
        if not (p_notes ? field_name) or jsonb_typeof(p_notes -> field_name) <> 'string' then raise exception 'All note fields must be text'; end if;
        if length(p_notes ->> field_name) > 20000 then raise exception 'Each note field must be at most 20000 characters'; end if;
        normalized := normalized || jsonb_build_object(field_name, btrim(p_notes ->> field_name));
    end loop;
    if not exists (select 1 from jsonb_each_text(normalized) where value <> '') then raise exception 'Enter consultation notes before saving'; end if;
    select * into v from public.visits where id = p_visit_id for update;
    if not found or v.doctor_id is distinct from auth.uid() or v.kind <> 'appointment' or v.status <> 'completed' then
        raise exception 'This completed consultation is not assigned to you';
    end if;
    select * into saved from public."Notes" where visit_id = v.id for update;
    if not found or saved.doctor_id is distinct from auth.uid() then raise exception 'Saved notes not found for this doctor'; end if;
    current_notes := to_jsonb(saved) - array['id','visit_id','patient_id','doctor_id','created_at'];
    -- Identical retries succeed; stale forms cannot overwrite another saved change.
    if current_notes = normalized then return saved.id; end if;
    if p_expected_notes is distinct from current_notes then raise exception 'These notes changed in another window. Copy your changes, reopen the consultation, and review the latest notes'; end if;
    update public."Notes" set subjective=normalized->>'subjective', objective=normalized->>'objective',
        history=normalized->>'history', assessment=normalized->>'assessment', plan=normalized->>'plan',
        rx=normalized->>'rx', referral=normalized->>'referral', recommendation=normalized->>'recommendation',
        admitting_orders=normalized->>'admitting_orders', pf=normalized->>'pf', diagnostic=normalized->>'diagnostic'
    where id = saved.id;
    return saved.id;
end;
$$;
revoke all on function public.update_consultation_notes(bigint,jsonb,jsonb) from public, anon;
grant execute on function public.update_consultation_notes(bigint,jsonb,jsonb) to authenticated;
commit;

-- Cancellation permanently deletes the visit/schedule, not the patient.
-- Run after the consultation notes migrations.
begin;
create or replace function public.cancel_visit(p_visit_id bigint, p_expected_status text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v public.visits%rowtype;
begin
    if public.clinic_role() is null or public.clinic_role() not in ('secretary', 'admin') then
        raise exception 'Only a secretary or administrator can cancel a visit';
    end if;
    if p_expected_status is null or p_expected_status not in ('waiting', 'scheduled') then
        raise exception 'Only waiting or scheduled visits can be cancelled';
    end if;
    select * into v from public.visits where id = p_visit_id for update;
    if not found then return p_visit_id; end if;
    if v.status is distinct from p_expected_status then
        raise exception 'This visit has changed. Refresh the queue or schedule before cancelling';
    end if;
    -- The Notes foreign key also prevents deleting a visit with saved clinical notes.
    delete from public.visits where id = v.id;
    return v.id;
end;
$$;
revoke all on function public.cancel_visit(bigint,text) from public, anon;
grant execute on function public.cancel_visit(bigint,text) to authenticated;

-- Remove existing cancelled visits. Linked push jobs are removed by their FK cascade.
-- If a cancelled visit has saved Notes, its restrictive FK stops this transaction.
delete from public.visits where status = 'cancelled';
notify pgrst, 'reload schema';
commit;

-- Allow active secretaries to read saved consultation notes in patient profiles.
-- Editing remains restricted to the assigned doctor through existing RPCs.
begin;
drop policy if exists "Secretaries read consultation notes" on public."Notes";
create policy "Secretaries read consultation notes"
on public."Notes" for select to authenticated
using (public.clinic_role() = 'secretary');
commit;
