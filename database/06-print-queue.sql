-- Run after the consultation notes and secretary note access migrations.
-- Notes themselves are the queue; receipts record which saved revision was printed.
begin;
create table if not exists public.note_print_receipts (
    note_id bigint primary key references public."Notes"(id) on delete cascade,
    note_snapshot jsonb not null,
    printed_at timestamptz not null default now(),
    printed_by uuid not null references public.staff(id)
);
alter table public.note_print_receipts enable row level security;
revoke all on public.note_print_receipts from anon, authenticated;
grant select on public.note_print_receipts to authenticated;
drop policy if exists "Staff read accessible print receipts" on public.note_print_receipts;
create policy "Staff read accessible print receipts" on public.note_print_receipts for select to authenticated
using (public.clinic_role() in ('doctor', 'secretary', 'admin') and exists (
    select 1 from public."Notes" n where n.id = note_id
    and (public.clinic_role() in ('secretary', 'admin') or n.doctor_id = auth.uid())
));
drop policy if exists "Secretaries read consultation notes" on public."Notes";
create policy "Secretaries read consultation notes" on public."Notes" for select to authenticated
using (public.clinic_role() = 'secretary');
create or replace function public.mark_notes_printed(p_note_id bigint, p_expected_notes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare n public."Notes"%rowtype;
begin
    if public.clinic_role() is null or public.clinic_role() not in ('doctor', 'secretary', 'admin') then
        raise exception 'Only active clinic staff can mark notes as printed';
    end if;
    select * into n from public."Notes" where id = p_note_id for update;
    if not found or (public.clinic_role() = 'doctor' and n.doctor_id <> auth.uid()) then
        raise exception 'These notes are not available to you';
    end if;
    if p_expected_notes is distinct from to_jsonb(n) then
        raise exception 'Notes changed. Refresh the preview and print the latest version first';
    end if;
    insert into public.note_print_receipts(note_id, note_snapshot, printed_at, printed_by)
    values (n.id, to_jsonb(n), now(), auth.uid())
    on conflict (note_id) do update set note_snapshot = excluded.note_snapshot,
        printed_at = excluded.printed_at, printed_by = excluded.printed_by;
end;
$$;
revoke all on function public.mark_notes_printed(bigint,jsonb) from public, anon;
grant execute on function public.mark_notes_printed(bigint,jsonb) to authenticated;
commit;
