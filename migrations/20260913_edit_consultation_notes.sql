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
    fields text[] := array['subjective','objective','history','assessment','plan','rx','referral','recommendation','admitting_orders'];
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
        admitting_orders=normalized->>'admitting_orders'
    where id = saved.id;
    return saved.id;
end;
$$;
revoke all on function public.update_consultation_notes(bigint,jsonb,jsonb) from public, anon;
grant execute on function public.update_consultation_notes(bigint,jsonb,jsonb) to authenticated;
commit;
