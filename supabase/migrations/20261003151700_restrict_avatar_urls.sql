-- Avatars render with next/image `unoptimized`, so each viewer's browser
-- fetches avatar_url directly. Members could set their profile or team avatar
-- to their own server and log the IP address of every leaguemate who opened
-- the league. Only allow the hosts the app itself produces:
--   * the avatars / team-avatars buckets on a Supabase storage host:
--     production's custom domain (api.fantasyreel.com), any *.supabase.co
--     project host (uploads made before the custom domain), the issuer
--     origin of the writer's own JWT, and 127.0.0.1/localhost:54321 locally;
--   * Discord and Google sign-in photos (handle_new_user and
--     sync_oauth_profile copy these from OAuth metadata).
-- The frontend's safeAvatarUrl() (apps/frontend/utils/avatar.ts) mirrors this
-- and also pins storage to the deployment's own Supabase origin and project
-- ref, closing the gap of another project's *.supabase.co host.
--
-- Existing rows are left alone; the frontend refuses to render any that fail.

CREATE OR REPLACE FUNCTION public.is_allowed_avatar_url(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_url IS NULL OR (
    length(p_url) <= 2048
    AND p_url ~ '^[^\s\\]+$'
    AND (
      p_url ~ '^https://([a-z0-9]+\.supabase\.co|api\.fantasyreel\.com)/storage/v1/object/public/(avatars|team-avatars)/.+$'
      OR p_url ~ '^http://(127\.0\.0\.1|localhost):54321/storage/v1/object/public/(avatars|team-avatars)/.+$'
      OR p_url ~ '^https://cdn\.discordapp\.com/.+$'
      OR p_url ~ '^https://lh[0-9]+\.googleusercontent\.com/.+$'
    )
  );
$$;

-- Client writes (PostgREST as anon/authenticated) of a disallowed URL are
-- refused so the caller sees an error. Server-side writers (OAuth profile
-- sync on auth.users, season rollover copying team avatars, Edge Functions)
-- get the avatar dropped instead, so an unexpected provider host can never
-- fail a sign-in or a rollover. An UPDATE that leaves the value unchanged is
-- never checked, so rows written before this migration stay editable.
--
-- A client upload's public URL is built from NEXT_PUBLIC_SUPABASE_URL, which
-- is the same API origin that issued the caller's JWT. Accepting that
-- origin's avatar buckets keeps uploads working if the API host ever differs
-- from the ones listed above.
CREATE OR REPLACE FUNCTION public.enforce_allowed_avatar_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_issuer_origin text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url THEN
    RETURN NEW;
  END IF;

  IF public.is_allowed_avatar_url(NEW.avatar_url) THEN
    RETURN NEW;
  END IF;

  v_issuer_origin := substring(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'iss'
    FROM '^(https://[a-z0-9.-]+)/auth/v1$'
  );
  IF v_issuer_origin IS NOT NULL
    AND length(NEW.avatar_url) <= 2048
    AND NEW.avatar_url ~ '^[^\s\\]+$'
    AND starts_with(NEW.avatar_url, v_issuer_origin || '/storage/v1/object/public/')
    AND substr(NEW.avatar_url, length(v_issuer_origin) + 1) ~ '^/storage/v1/object/public/(avatars|team-avatars)/.+$'
  THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Avatar must be an uploaded image'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.avatar_url := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_allowed_avatar_url ON public.profiles;
CREATE TRIGGER enforce_allowed_avatar_url
  BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_allowed_avatar_url();

DROP TRIGGER IF EXISTS enforce_allowed_avatar_url ON public.teams;
CREATE TRIGGER enforce_allowed_avatar_url
  BEFORE INSERT OR UPDATE OF avatar_url ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_allowed_avatar_url();
