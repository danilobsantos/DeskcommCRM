do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='conversation_notes'
  ) then
    alter publication supabase_realtime add table conversation_notes;
  end if;
end $$;
