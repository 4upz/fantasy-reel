-- Cap avatar storage at one object per owner.
--
-- Uploads used to land at a new timestamped name each time, and nothing
-- limited how many files a user could write into their own folder, so one
-- account could fill the public avatars / team-avatars buckets. The frontend
-- now writes a single object, `<folder>/avatar`, with upsert
-- (apps/frontend/utils/avatarUpload.ts). These policies only accept that name:
--
--   * INSERT / UPDATE: exactly `<auth.uid()>/avatar` in avatars, and
--     `<team_id>/avatar` in team-avatars for the team's owner. WITH CHECK on
--     UPDATE also stops an object being renamed (moved) to any other name.
--   * SELECT: the owner's own folder. Upsert (INSERT ... ON CONFLICT DO
--     UPDATE) needs to see the existing row, and listing the folder lets the
--     frontend delete files left by older uploads. Public URLs don't use
--     these policies, so this changes nothing about who can view an avatar.
--   * DELETE keeps its rule: the owner may delete anything in their folder,
--     which is how those older files get cleaned up. The team policy is
--     recreated only to use the safe folder-id cast below.
--
-- Existing objects and the avatar_url values pointing at them are untouched
-- and keep displaying.

DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own avatar files" ON storage.objects;

CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND name = (SELECT auth.uid())::text || '/avatar'
);

CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND name = (SELECT auth.uid())::text || '/avatar'
)
WITH CHECK (
  bucket_id = 'avatars'
  AND name = (SELECT auth.uid())::text || '/avatar'
);

CREATE POLICY "Users can view own avatar files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

-- Team folders are named by team id. The first path segment is matched
-- against a UUID pattern before the cast, so a malformed name is refused
-- instead of raising a cast error (SELECT policies are evaluated for every
-- object an authenticated client reads, not only team avatars).
CREATE OR REPLACE FUNCTION public.storage_folder_uuid(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      THEN split_part(p_name, '/', 1)::uuid
  END;
$$;

REVOKE ALL ON FUNCTION public.storage_folder_uuid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_folder_uuid(text) TO authenticated;

DROP POLICY IF EXISTS "Team owners can upload team avatar" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can update team avatar" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can view team avatar files" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can delete team avatar" ON storage.objects;

CREATE POLICY "Team owners can upload team avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'team-avatars'
  AND name = public.storage_folder_uuid(name)::text || '/avatar'
  AND is_team_owner(public.storage_folder_uuid(name))
);

CREATE POLICY "Team owners can update team avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'team-avatars'
  AND name = public.storage_folder_uuid(name)::text || '/avatar'
  AND is_team_owner(public.storage_folder_uuid(name))
)
WITH CHECK (
  bucket_id = 'team-avatars'
  AND name = public.storage_folder_uuid(name)::text || '/avatar'
  AND is_team_owner(public.storage_folder_uuid(name))
);

CREATE POLICY "Team owners can view team avatar files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'team-avatars'
  AND is_team_owner(public.storage_folder_uuid(name))
);

-- Same rule as before (anything in the team's folder), with the safe cast.
CREATE POLICY "Team owners can delete team avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'team-avatars'
  AND is_team_owner(public.storage_folder_uuid(name))
);
