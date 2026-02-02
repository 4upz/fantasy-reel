-- Add foreign key from league_participants.user_id to profiles.user_id
-- This enables PostgREST to join participants with their profiles directly
-- Without this FK, queries like .select(`*, profiles (*)`) fail with PGRST200

ALTER TABLE league_participants
ADD CONSTRAINT league_participants_user_id_profiles_fkey
FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

-- Add comment to document the relationship
COMMENT ON CONSTRAINT league_participants_user_id_profiles_fkey ON league_participants IS
  'Enables PostgREST join between league_participants and profiles via user_id';
