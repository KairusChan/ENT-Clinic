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
    created_at timestamptz not null default now(),
    constraint notes_not_empty check (length(btrim(subjective || objective || history || assessment || plan || rx || referral || recommendation || admitting_orders)) > 0)
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
    fields text[] := array['subjective','objective','history','assessment','plan','rx','referral','recommendation','admitting_orders'];
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
    insert into public."Notes" (visit_id, patient_id, doctor_id, subjective, objective, history, assessment, plan, rx, referral, recommendation, admitting_orders)
    values (v.id, v.patient_id, auth.uid(), normalized->>'subjective', normalized->>'objective', normalized->>'history',
        normalized->>'assessment', normalized->>'plan', normalized->>'rx', normalized->>'referral', normalized->>'recommendation', normalized->>'admitting_orders')
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
