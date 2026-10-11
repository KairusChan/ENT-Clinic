-- Apply in Supabase SQL Editor after the existing consultation migrations.
begin;
create table if not exists public.medication_prescription_catalogs (
    doctor_id uuid primary key references public.staff(id) on delete cascade,
    revision bigint not null default 0
);
create table if not exists public.medication_prescriptions (
    id bigint generated always as identity primary key,
    doctor_id uuid not null references public.medication_prescription_catalogs(doctor_id) on delete cascade,
    position integer not null,
    name text not null check (length(btrim(name)) between 1 and 200 and name !~ E'[\r\n]'),
    remarks text not null check (length(btrim(remarks)) between 1 and 20000),
    unique (doctor_id, position)
);
create unique index if not exists medication_prescriptions_name on public.medication_prescriptions (doctor_id, lower(btrim(name)));
alter table public.medication_prescription_catalogs enable row level security;
alter table public.medication_prescriptions enable row level security;
drop policy if exists medication_catalog_read on public.medication_prescription_catalogs;
create policy medication_catalog_read on public.medication_prescription_catalogs for select to authenticated
using (doctor_id = auth.uid() and public.clinic_role() in ('doctor','admin'));
drop policy if exists medication_prescriptions_read on public.medication_prescriptions;
create policy medication_prescriptions_read on public.medication_prescriptions for select to authenticated
using (doctor_id = auth.uid() and public.clinic_role() in ('doctor','admin'));
revoke all on public.medication_prescription_catalogs, public.medication_prescriptions from anon, authenticated;
grant select on public.medication_prescription_catalogs, public.medication_prescriptions to authenticated;

create or replace function public.load_medication_prescriptions(p_seed jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare created uuid; result jsonb;
begin
    if auth.uid() is null or public.clinic_role() not in ('doctor','admin') or public.clinic_role() is null then raise exception 'Only active doctors or administrators can manage presets'; end if;
    if jsonb_typeof(p_seed) is distinct from 'array' then raise exception 'Invalid preset list'; end if;
    insert into public.medication_prescription_catalogs (doctor_id) values (auth.uid()) on conflict do nothing returning doctor_id into created;
    if created is not null then
        if exists (select 1 from jsonb_array_elements(p_seed) x where jsonb_typeof(x->'name') is distinct from 'string' or jsonb_typeof(x->'remarks') is distinct from 'string') then raise exception 'Invalid medication'; end if;
        insert into public.medication_prescriptions (doctor_id, position, name, remarks)
        select auth.uid(), ordinality::integer, btrim(value->>'name'), value->>'remarks' from jsonb_array_elements(p_seed) with ordinality;
    end if;
    -- Serialize reads with writes so revision and rows describe the same snapshot.
    perform 1 from public.medication_prescription_catalogs where doctor_id = auth.uid() for update;
    select jsonb_build_object('revision', c.revision, 'items', coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'remarks',m.remarks) order by m.position) from public.medication_prescriptions m where m.doctor_id=c.doctor_id), '[]'::jsonb)) into result
    from public.medication_prescription_catalogs c where c.doctor_id=auth.uid();
    return result;
end;
$$;
create or replace function public.save_medication_prescriptions(p_items jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare current_revision bigint;
begin
    if auth.uid() is null or public.clinic_role() not in ('doctor','admin') or public.clinic_role() is null then raise exception 'Only active doctors or administrators can manage presets'; end if;
    if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid preset list'; end if;
    if exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x->'name') is distinct from 'string' or jsonb_typeof(x->'remarks') is distinct from 'string') then raise exception 'Invalid medication'; end if;
    select revision into current_revision from public.medication_prescription_catalogs where doctor_id=auth.uid() for update;
    if not found or current_revision is distinct from p_expected_revision then raise exception 'Presets changed. Reload this page before saving'; end if;
    delete from public.medication_prescriptions where doctor_id=auth.uid();
    insert into public.medication_prescriptions (doctor_id, position, name, remarks)
    select auth.uid(), ordinality::integer, btrim(value->>'name'), value->>'remarks' from jsonb_array_elements(p_items) with ordinality;
    update public.medication_prescription_catalogs set revision=revision+1 where doctor_id=auth.uid() returning revision into current_revision;
    return current_revision;
end;
$$;
revoke all on function public.load_medication_prescriptions(jsonb), public.save_medication_prescriptions(jsonb,bigint) from public, anon;
grant execute on function public.load_medication_prescriptions(jsonb), public.save_medication_prescriptions(jsonb,bigint) to authenticated;

-- Recommendations remain part of the atomic consultation save. The trigger
-- also stores their individual fields here for reporting and future editors.
create table if not exists public.consultation_recommendations (
    note_id bigint primary key references public."Notes"(id) on delete cascade,
    clinical_impression text not null default '',
    rest_period text not null default '',
    further_recommendations text not null default '',
    source_text text not null default '',
    updated_at timestamptz not null default now()
);
alter table public.consultation_recommendations enable row level security;
drop policy if exists recommendation_read on public.consultation_recommendations;
create policy recommendation_read on public.consultation_recommendations for select to authenticated
using (exists (select 1 from public."Notes" n where n.id=note_id));
revoke all on public.consultation_recommendations from anon, authenticated;
grant select on public.consultation_recommendations to authenticated;
create or replace function public.sync_consultation_recommendation()
returns trigger language plpgsql security definer set search_path = public as $$
declare parts text[]; content text := coalesce(new.recommendation,'');
begin
    parts := regexp_match(content, E'^Clinical impression:\n(.*?)\nMedical attention/rest:\n(.*?)\nFurther recommendations:(?:\n(.*))?$', 's');
    insert into public.consultation_recommendations(note_id,clinical_impression,rest_period,further_recommendations,source_text)
    values (new.id,coalesce(parts[1],''),coalesce(parts[2],''),case when parts is null then content else coalesce(parts[3],'') end,content)
    on conflict (note_id) do update set clinical_impression=excluded.clinical_impression,rest_period=excluded.rest_period,further_recommendations=excluded.further_recommendations,source_text=excluded.source_text,updated_at=now();
    return new;
end;
$$;
revoke all on function public.sync_consultation_recommendation() from public, anon, authenticated;
drop trigger if exists sync_consultation_recommendation on public."Notes";
create trigger sync_consultation_recommendation after insert or update of recommendation on public."Notes" for each row execute function public.sync_consultation_recommendation();
-- Backfill without touching saved notes or their existing print receipts.
insert into public.consultation_recommendations(note_id,clinical_impression,rest_period,further_recommendations,source_text)
select n.id,coalesce(p.parts[1],''),coalesce(p.parts[2],''),case when p.parts is null then coalesce(n.recommendation,'') else coalesce(p.parts[3],'') end,coalesce(n.recommendation,'')
from public."Notes" n
cross join lateral (select regexp_match(coalesce(n.recommendation,''), E'^Clinical impression:\n(.*?)\nMedical attention/rest:\n(.*?)\nFurther recommendations:(?:\n(.*))?$', 's') as parts) p
on conflict (note_id) do nothing;
commit;
