-- Signing in with a second OAuth provider replaced the profile picture.
--
-- Supabase Auth rewrites auth.users.raw_user_meta_data with the identity
-- that signed in last, and sync_oauth_profile() (on_auth_user_updated) copied
-- whatever avatar that metadata held into profiles. So a Discord member who
-- linked Google took on their Google photo, and switched back on the next
-- Discord sign-in. The same trigger also fired on any other metadata write
-- (the Settings display-name sync), replacing an uploaded avatar with the
-- provider photo.
--
-- The picture now stays the one the account started with, or whatever the
-- member chose since. The sync only refreshes a provider photo from that same
-- provider: a new Discord avatar hash replaces the old Discord URL, which
-- would otherwise go stale and stop loading. It never replaces an upload, a
-- different provider's photo, or no avatar (a member who removed theirs, or
-- an email sign-up linking Discord later).

CREATE OR REPLACE FUNCTION public.oauth_avatar_provider(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_url ~ '^https://cdn\.discordapp\.com/' THEN 'discord'
    WHEN p_url ~ '^https://lh[0-9]+\.googleusercontent\.com/' THEN 'google'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_oauth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_avatar_url text;
  v_provider text;
BEGIN
  -- Discord uses 'avatar_url', Google uses 'picture'
  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture'
  );
  v_provider := public.oauth_avatar_provider(v_avatar_url);

  IF v_provider IS NOT NULL THEN
    UPDATE public.profiles
    SET avatar_url = v_avatar_url,
        updated_at = now()
    WHERE user_id = NEW.id
      AND avatar_url IS DISTINCT FROM v_avatar_url
      AND public.oauth_avatar_provider(avatar_url) = v_provider;
  END IF;

  RETURN NEW;
END;
$$;
