-- Create team-avatars storage bucket with RLS policies
-- Folder structure: team-avatars/{team_id}/{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-avatars',
  'team-avatars',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Team owners can upload team avatar" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can update team avatar" ON storage.objects;
DROP POLICY IF EXISTS "Team owners can delete team avatar" ON storage.objects;

CREATE POLICY "Team owners can upload team avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'team-avatars' AND
  is_team_owner((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Team owners can update team avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'team-avatars' AND
  is_team_owner((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Team owners can delete team avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'team-avatars' AND
  is_team_owner((storage.foldername(name))[1]::uuid)
);
