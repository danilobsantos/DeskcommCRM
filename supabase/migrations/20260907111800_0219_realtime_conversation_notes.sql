begin;

  -- Add conversation_notes to supabase_realtime publication for WebSocket subscriptions
  alter publication supabase_realtime add table conversation_notes;

commit;
