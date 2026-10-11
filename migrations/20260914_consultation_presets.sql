-- Run after 20260913_edit_consultation_notes.sql, before serving the updated form.
begin;
alter table public."Notes" add column if not exists pf text not null default '';
alter table public."Notes" add column if not exists diagnostic text not null default '';
alter table public."Notes" drop constraint if exists notes_not_empty;
alter table public."Notes" add constraint notes_not_empty check
    (length(btrim(subjective || objective || history || assessment || plan || rx || referral || recommendation || admitting_orders || pf || diagnostic)) > 0);

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
commit;
