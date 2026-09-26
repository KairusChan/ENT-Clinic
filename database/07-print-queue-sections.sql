-- Independent printed receipts for the four printable note sections.
-- Can be installed whether or not the earlier whole-note print migration was run.
begin;
create table if not exists public.note_section_print_receipts (
    note_id bigint not null references public."Notes"(id) on delete cascade,
    section text not null check (section in ('diagnostic','recommendation','referral','admitting_orders')),
    content text not null,
    printed_at timestamptz not null default now(),
    printed_by uuid not null references public.staff(id),
    primary key (note_id, section)
);
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
    if p_section is null or p_section not in ('diagnostic','recommendation','referral','admitting_orders') then
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
