-- Run in Supabase SQL Editor before serving the updated consultation page.
-- Existing diagnostic content was Medication; move it once without losing it.
begin;
lock table public."Notes" in access exclusive mode;
alter table public."Notes" drop constraint if exists notes_not_empty;
do $$ begin
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'Notes' and column_name = 'medication') then
        alter table public."Notes" add column medication text not null default '';
        update public."Notes" set medication = coalesce(diagnostic, ''), diagnostic = '';
        if to_regclass('public.note_section_print_receipts') is not null then
            alter table public.note_section_print_receipts drop constraint if exists note_section_print_receipts_section_check;
            update public.note_section_print_receipts set section = 'medication' where section = 'diagnostic';
        end if;
    end if;
end $$;
alter table public."Notes" add constraint notes_not_empty check
(length(btrim(subjective || objective || history || assessment || plan || rx || referral || recommendation || admitting_orders || pf || diagnostic || medication)) > 0);
create or replace function public.save_consultation_notes(p_visit_id bigint, p_notes jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
    v public.visits%rowtype;
    existing public."Notes"%rowtype;
    note_id bigint;
    field_name text;
    normalized jsonb := '{}'::jsonb;
    fields text[] := array['subjective','objective','history','assessment','plan','rx','referral','recommendation','admitting_orders','pf','diagnostic','medication'];
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can save consultation notes'; end if;
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' then raise exception 'Notes must be an object'; end if;
    if not (p_notes ? 'medication') then raise exception 'Reload the consultation page before saving; Medication and Diagnostic are now separate'; end if;
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
    insert into public."Notes" (visit_id, patient_id, doctor_id, subjective, objective, history, assessment, plan, rx, referral, recommendation, admitting_orders, pf, diagnostic, medication)
    values (v.id, v.patient_id, auth.uid(), normalized->>'subjective', normalized->>'objective', normalized->>'history',
        normalized->>'assessment', normalized->>'plan', normalized->>'rx', normalized->>'referral', normalized->>'recommendation', normalized->>'admitting_orders', normalized->>'pf', normalized->>'diagnostic', normalized->>'medication')
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
    fields text[] := array['subjective','objective','history','assessment','plan','rx','referral','recommendation','admitting_orders','pf','diagnostic','medication'];
begin
    if public.clinic_role() is distinct from 'doctor' then raise exception 'Only an active doctor can edit consultation notes'; end if;
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' then raise exception 'Notes must be an object'; end if;
    if not (p_notes ? 'medication') then raise exception 'Reload the consultation page before saving; Medication and Diagnostic are now separate'; end if;
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
        admitting_orders=normalized->>'admitting_orders', pf=normalized->>'pf', diagnostic=normalized->>'diagnostic', medication=normalized->>'medication'
    where id = saved.id;
    return saved.id;
end;
$$;

revoke all on function public.save_consultation_notes(bigint,jsonb), public.update_consultation_notes(bigint,jsonb,jsonb) from public, anon;
grant execute on function public.save_consultation_notes(bigint,jsonb), public.update_consultation_notes(bigint,jsonb,jsonb) to authenticated;
create table if not exists public.note_section_print_receipts (
    note_id bigint not null references public."Notes"(id) on delete cascade,
    section text not null check (section in ('medication','diagnostic','recommendation','referral','admitting_orders')),
    content text not null,
    printed_at timestamptz not null default now(),
    printed_by uuid not null references public.staff(id),
    primary key (note_id, section)
);
alter table public.note_section_print_receipts drop constraint if exists note_section_print_receipts_section_check;
alter table public.note_section_print_receipts add constraint note_section_print_receipts_section_check check (section in ('medication','diagnostic','recommendation','referral','admitting_orders'));
alter table public.note_section_print_receipts enable row level security;
revoke all on public.note_section_print_receipts from anon, authenticated;
grant select on public.note_section_print_receipts to authenticated;
drop policy if exists "Staff read accessible section receipts" on public.note_section_print_receipts;
create policy "Staff read accessible section receipts" on public.note_section_print_receipts for select to authenticated
using (public.clinic_role() in ('doctor','secretary','admin') and exists (
    select 1 from public."Notes" n where n.id = note_id
    and (public.clinic_role() in ('secretary','admin') or n.doctor_id = auth.uid())
));
drop policy if exists "Secretaries read consultation notes" on public."Notes";
create policy "Secretaries read consultation notes" on public."Notes" for select to authenticated using (public.clinic_role() = 'secretary');
create or replace function public.mark_note_section_printed(p_note_id bigint, p_section text, p_expected_content text)
returns void language plpgsql security definer set search_path = public as $$
declare n public."Notes"%rowtype; saved_content text;
begin
    if public.clinic_role() is null or public.clinic_role() not in ('doctor','secretary','admin') then
        raise exception 'Only active clinic staff can mark notes as printed';
    end if;
    if p_section is null or p_section not in ('medication','diagnostic','recommendation','referral','admitting_orders') then
        raise exception 'Choose a printable note section';
    end if;
    select * into n from public."Notes" where id = p_note_id for update;
    if not found or (public.clinic_role() = 'doctor' and n.doctor_id <> auth.uid()) then
        raise exception 'These notes are not available to you';
    end if;
    saved_content := to_jsonb(n) ->> p_section;
    if coalesce(btrim(saved_content), '') = '' then raise exception 'This section is empty'; end if;
    if p_expected_content is distinct from saved_content then
        raise exception 'This section changed. Refresh and print the latest version first';
    end if;
    insert into public.note_section_print_receipts(note_id, section, content, printed_at, printed_by)
    values (n.id, p_section, saved_content, now(), auth.uid())
    on conflict (note_id, section) do update set content = excluded.content,
        printed_at = excluded.printed_at, printed_by = excluded.printed_by;
end;
$$;
revoke all on function public.mark_note_section_printed(bigint,text,text) from public, anon;
grant execute on function public.mark_note_section_printed(bigint,text,text) to authenticated;
commit;

notify pgrst, 'reload schema';
