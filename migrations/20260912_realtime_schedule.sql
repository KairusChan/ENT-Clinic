-- Run after the scheduling and event migrations. Enables live schedule updates.
begin;
do $$
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'visits') then
        alter publication supabase_realtime add table public.visits;
    end if;
end;
$$;
commit;
