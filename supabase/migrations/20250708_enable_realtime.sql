-- Migration: Enable Realtime for draft_picks and leagues tables
-- This allows the frontend to subscribe to real-time updates during drafting

-- Add tables to the supabase_realtime publication
-- Note: The publication already exists in Supabase, we just need to add tables to it

alter publication supabase_realtime add table leagues;
alter publication supabase_realtime add table draft_picks;
alter publication supabase_realtime add table league_participants;
