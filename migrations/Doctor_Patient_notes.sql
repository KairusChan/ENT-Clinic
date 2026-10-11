begin;

-- Exact table name: Notes
create table if not exists public."Notes" (
    id bigint generated always as identity primary key,
    visit_id bigint not null unique
        references public.visits(id) on delete restrict,
    patient_id bigint not null
        references public.patients(id) on delete restrict,
    doctor_id uuid not null
        references public.staff(id) on delete restrict,

    subjective text not null default '',
    objective text not null default '',
    history text not null default '',
    assessment text not null default '',
    plan text not null default '',
    rx text not null default '',
    referral text not null default '',
    recommendation text not null default '',
    admitting_orders text not null default '',

    created_at timestamptz not null default now(),

    constraint notes_not_empty check (
        length(btrim(
            subjective || objective || history ||
            assessment || plan || rx || referral ||
            recommendation || admitting_orders
        )) > 0
    )
);

create index if not exists notes_patient_idx
    on public."Notes"(patient_id);

-- Access helpers.
create or replace function public.clinic_role()
returns text
language sql stable
security definer set search_path = public
as $$
    select role from public.staff
    where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
    select exists (
        select 1 from public.staff
        where id = auth.uid()
          and role = 'admin'
          and is_active = true
    );
$$;

-- Doctors read their own notes; admins can read all notes.
-- Writes go through the protected functions below.
alter table public."Notes" enable row level security;

revoke all on public."Notes" from anon, authenticated;
grant select on public."Notes" to authenticated;
grant all on public."Notes" to service_role;
grant usage, select on sequence public."Notes_id_seq"
    to service_role;

drop policy if exists "Doctors read their consultation notes"
    on public."Notes";

create policy "Doctors read their consultation notes"
on public."Notes"
for select to authenticated
using (
    (public.clinic_role() = 'doctor' and doctor_id = auth.uid())
    or public.is_admin()
);

-- Validate all nine text fields.
create or replace function public.normalize_consultation_notes(
    p_notes jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    field_name text;
    result jsonb := '{}'::jsonb;
begin
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' then
        raise exception 'Notes must be an object';
    end if;

    foreach field_name in array array[
        'subjective', 'objective', 'history', 'assessment',
        'plan', 'rx', 'referral', 'recommendation',
        'admitting_orders'
    ] loop
        if p_notes ? field_name
           and jsonb_typeof(p_notes -> field_name) <> 'string' then
            raise exception 'Note fields must be text';
        end if;

        if length(coalesce(p_notes ->> field_name, '')) > 20000 then
            raise exception 'Each note field must be at most 20000 characters';
        end if;

        result := result || jsonb_build_object(
            field_name,
            btrim(coalesce(p_notes ->> field_name, ''))
        );
    end loop;

    if not exists (
        select 1 from jsonb_each_text(result) where value <> ''
    ) then
        raise exception 'Enter consultation notes before saving';
    end if;

    return result;
end;
$$;

-- Accept Patient: Waiting -> With Doctor.
create or replace function public.accept_consultation(
    p_visit_id bigint
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
    v public.visits%rowtype;
begin
    if public.clinic_role() is distinct from 'doctor' then
        raise exception 'Only an active doctor can accept a patient';
    end if;

    select * into v
    from public.visits
    where id = p_visit_id
    for update;

    if not found
       or v.doctor_id is distinct from auth.uid()
       or v.kind <> 'appointment' then
        raise exception 'This consultation is not assigned to you';
    end if;

    if v.status not in ('waiting', 'with_doctor') then
        raise exception 'This patient is no longer waiting for consultation';
    end if;

    if v.status = 'waiting' then
        update public.visits
        set status = 'with_doctor'
        where id = v.id;
    end if;

    return v.id;
end;
$$;

-- Save Notes: create the note and complete the visit together.
create or replace function public.save_consultation_notes(
    p_visit_id bigint,
    p_notes jsonb
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
    v public.visits%rowtype;
    saved public."Notes"%rowtype;
    n jsonb;
    note_id bigint;
begin
    if public.clinic_role() is distinct from 'doctor' then
        raise exception 'Only an active doctor can save consultation notes';
    end if;

    n := public.normalize_consultation_notes(p_notes);

    select * into v
    from public.visits
    where id = p_visit_id
    for update;

    if not found
       or v.doctor_id is distinct from auth.uid()
       or v.kind <> 'appointment' then
        raise exception 'This consultation is not assigned to you';
    end if;

    select * into saved
    from public."Notes"
    where visit_id = v.id;

    if found then
        -- A retry cannot create a duplicate note.
        if saved.doctor_id = auth.uid()
           and v.status = 'completed'
           and public.normalize_consultation_notes(to_jsonb(saved)) = n then
            return saved.id;
        end if;

        raise exception 'Notes already exist. Reopen them to edit';
    end if;

    if v.status <> 'with_doctor' then
        raise exception 'Accept this patient before saving notes';
    end if;

    insert into public."Notes" (
        visit_id, patient_id, doctor_id,
        subjective, objective, history, assessment,
        plan, rx, referral, recommendation, admitting_orders
    )
    values (
        v.id, v.patient_id, auth.uid(),
        n->>'subjective', n->>'objective', n->>'history',
        n->>'assessment', n->>'plan', n->>'rx',
        n->>'referral', n->>'recommendation',
        n->>'admitting_orders'
    )
    returning id into note_id;

    update public.visits
    set status = 'completed'
    where id = v.id;

    return note_id;
end;
$$;

-- Save Changes: edit an existing note without reopening the visit.
create or replace function public.update_consultation_notes(
    p_visit_id bigint,
    p_notes jsonb,
    p_expected_notes jsonb
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
    v public.visits%rowtype;
    saved public."Notes"%rowtype;
    current_notes jsonb;
    n jsonb;
begin
    if public.clinic_role() is distinct from 'doctor' then
        raise exception 'Only an active doctor can edit consultation notes';
    end if;

    n := public.normalize_consultation_notes(p_notes);

    select * into v
    from public.visits
    where id = p_visit_id
    for update;

    if not found
       or v.doctor_id is distinct from auth.uid()
       or v.kind <> 'appointment'
       or v.status <> 'completed' then
        raise exception 'This completed consultation is not assigned to you';
    end if;

    select * into saved
    from public."Notes"
    where visit_id = v.id
    for update;

    if not found or saved.doctor_id is distinct from auth.uid() then
        raise exception 'Saved notes not found for this doctor';
    end if;

    current_notes := public.normalize_consultation_notes(to_jsonb(saved));

    if current_notes = n then
        return saved.id;
    end if;

    -- Prevent one open window from overwriting changes made in another.
    if p_expected_notes is distinct from current_notes then
        raise exception 'These notes changed elsewhere. Copy your changes and reopen the consultation';
    end if;

    update public."Notes"
    set subjective = n->>'subjective',
        objective = n->>'objective',
        history = n->>'history',
        assessment = n->>'assessment',
        plan = n->>'plan',
        rx = n->>'rx',
        referral = n->>'referral',
        recommendation = n->>'recommendation',
        admitting_orders = n->>'admitting_orders'
    where id = saved.id;

    return saved.id;
end;
$$;

-- Protect the consultation workflow and saved note relationships.
create or replace function public.guard_consultation_workflow()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    if exists (
        select 1 from public."Notes" where visit_id = old.id
    ) then
        if row(new.patient_id, new.doctor_id, new.kind, new.status)
           is distinct from
           row(old.patient_id, old.doctor_id, old.kind, 'completed'::text)
        then
            raise exception 'A saved consultation cannot be reopened or reassigned';
        end if;

    elsif new.kind = 'appointment'
          and new.status is distinct from old.status then

        if new.status = 'completed' then
            raise exception 'Save consultation notes to complete this visit';
        end if;

        if new.status = 'with_doctor'
           and (
               public.clinic_role() is distinct from 'doctor'
               or new.doctor_id is distinct from auth.uid()
           ) then
            raise exception 'The assigned doctor must accept this patient';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists visits_guard_consultation on public.visits;
create trigger visits_guard_consultation
before update on public.visits
for each row
execute function public.guard_consultation_workflow();

revoke all on function public.normalize_consultation_notes(jsonb)
    from public, anon, authenticated;

revoke all on function public.accept_consultation(bigint)
    from public, anon;
revoke all on function public.save_consultation_notes(bigint, jsonb)
    from public, anon;
revoke all on function public.update_consultation_notes(bigint, jsonb, jsonb)
    from public, anon;

grant execute on function public.accept_consultation(bigint)
    to authenticated;
grant execute on function public.save_consultation_notes(bigint, jsonb)
    to authenticated;
grant execute on function public.update_consultation_notes(bigint, jsonb, jsonb)
    to authenticated;

notify pgrst, 'reload schema';

commit;