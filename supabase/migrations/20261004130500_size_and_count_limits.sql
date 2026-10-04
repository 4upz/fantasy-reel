-- Size and count limits on client-writable data (abuse review M3/M4, data
-- review D13).
--
-- Clients write several tables directly through PostgREST, and nothing bounded
-- what they stored: a 5,000,000-character wishlist title, a 100000-person
-- league and 200 leagues in one statement were all accepted. These limits sit
-- far above anything the app itself writes, so they only stop abuse.
--
-- Rows written before this migration are never rejected after the fact:
--   * New CHECKs are added NOT VALID and then validated only if every existing
--     row passes, so a stray oversized row can't fail the deploy.
--   * Trade-offer text is checked by a trigger only when that column changes,
--     so process-trades can still expire an old offer with a long message.
--   * Count caps fire on INSERT only; a table already over a cap keeps its rows.

-- ---------------------------------------------------------------------------
-- leagues: create-league is the only way to create one
-- ---------------------------------------------------------------------------
-- The direct INSERT policy let a client skip create-league's validation
-- (participant and slot bounds) and create leagues in bulk. Every legitimate
-- creator already runs as the service role: create-league, start_next_season
-- (rollover) and the e2e admin helpers.
DROP POLICY IF EXISTS "Users can create leagues" ON public.leagues;
REVOKE INSERT ON TABLE public.leagues FROM anon, authenticated;

-- create-league and update-league allow 2-20. The database bound is looser so
-- a later product change doesn't need a migration, but stops 100000. Rows
-- outside it could only have come from a direct client write, so clamp them;
-- as the table owner this passes the client-only guard triggers.
UPDATE public.leagues
SET max_participants = LEAST(GREATEST(max_participants, 2), 50)
WHERE max_participants NOT BETWEEN 2 AND 50;

ALTER TABLE public.leagues
  ADD CONSTRAINT check_max_participants_bounds
  CHECK (max_participants BETWEEN 2 AND 50);

-- ---------------------------------------------------------------------------
-- league_series.name: the source of truth for leagues.name (varchar 255)
-- ---------------------------------------------------------------------------
ALTER TABLE public.league_series
  ADD CONSTRAINT check_league_series_name_length
  CHECK (char_length(name) <= 255) NOT VALID;

-- ---------------------------------------------------------------------------
-- wishlisted_movies: written directly by the frontend (useWishlist,
-- WishlistClient) and readable by other users when a wishlist is shared
-- ---------------------------------------------------------------------------
ALTER TABLE public.wishlisted_movies
  ADD CONSTRAINT check_wishlist_title_length
  CHECK (char_length(title) <= 500) NOT VALID;

-- Shared wishlists render poster_url in other users' browsers, so an
-- arbitrary host would log their IP addresses (as D4 found for avatars).
-- Allow TMDb image URLs, bare TMDb poster paths ("/abc.jpg"), and
-- same-origin paths; getTmdbPosterUrl() in the frontend accepts these forms.
ALTER TABLE public.wishlisted_movies
  ADD CONSTRAINT check_wishlist_poster_url
  CHECK (
    poster_url IS NULL OR (
      char_length(poster_url) <= 2048
      AND (
        poster_url ~ '^https://image\.tmdb\.org/[^\s\\]+$'
        OR poster_url ~ '^/[^/\s\\][^\s\\]*$'
      )
    )
  ) NOT VALID;

-- SECURITY INVOKER so current_user is the caller: only clients are capped,
-- and RLS already lets a user count their own rows.
CREATE FUNCTION public.enforce_wishlist_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wishlist_cap:' || NEW.user_id::text, 0));

  -- An upsert of a movie already on the list replaces it; it adds nothing.
  IF EXISTS (
    SELECT 1 FROM public.wishlisted_movies
    WHERE user_id = NEW.user_id AND tmdb_id = NEW.tmdb_id
  ) THEN
    RETURN NEW;
  END IF;

  IF (SELECT count(*) FROM public.wishlisted_movies WHERE user_id = NEW.user_id) >= 500 THEN
    RAISE EXCEPTION 'Your wishlist is full (500 movies). Remove some to add more.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_wishlist_cap
  BEFORE INSERT ON public.wishlisted_movies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_wishlist_cap();

-- ---------------------------------------------------------------------------
-- notifications: clients only ever mark them read
-- ---------------------------------------------------------------------------
-- The UPDATE policy let a user rewrite title/body/data of their own rows with
-- unbounded text. useNotifications only sets read_at, and every other write is
-- the service role.
REVOKE UPDATE ON TABLE public.notifications FROM anon, authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;

-- ---------------------------------------------------------------------------
-- discord_channels: Discord ids are ~20-digit snowflakes
-- ---------------------------------------------------------------------------
-- webhook_url is left to the webhook host allowlist change.
ALTER TABLE public.discord_channels
  ADD CONSTRAINT check_discord_channel_id_lengths
  CHECK (
    char_length(guild_id) <= 100
    AND char_length(channel_id) <= 100
    AND char_length(webhook_id) <= 100
    AND (thread_id IS NULL OR char_length(thread_id) <= 100)
    AND (bid_alert_role_id IS NULL OR char_length(bid_alert_role_id) <= 100)
    AND (bot_admin_role_id IS NULL OR char_length(bot_admin_role_id) <= 100)
  ) NOT VALID;

-- Each linked channel is another webhook every league event fans out to.
CREATE FUNCTION public.enforce_discord_channel_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.league_id IS NOT DISTINCT FROM OLD.league_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('discord_channel_cap:' || NEW.league_id::text, 0));

  IF (SELECT count(*) FROM public.discord_channels WHERE league_id = NEW.league_id) >= 25 THEN
    RAISE EXCEPTION 'This league already has the maximum of 25 linked Discord channels'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_discord_channel_cap
  BEFORE INSERT OR UPDATE OF league_id ON public.discord_channels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_discord_channel_cap();

-- ---------------------------------------------------------------------------
-- invitations: pending invitations per league
-- ---------------------------------------------------------------------------
-- League owners can insert invitation rows directly. A league holds at most
-- 20 people (create-league), so 100 open invitations is far beyond real use.
CREATE FUNCTION public.enforce_pending_invitation_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('invitation_cap:' || NEW.league_id::text, 0));

  IF (
    SELECT count(*) FROM public.invitations
    WHERE league_id = NEW.league_id AND status = 'pending'
  ) >= 100 THEN
    RAISE EXCEPTION 'This league already has 100 pending invitations. Cancel some before sending more.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_pending_invitation_cap
  BEFORE INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pending_invitation_cap();

-- ---------------------------------------------------------------------------
-- trade_offers: message length and open offers per proposing team
-- ---------------------------------------------------------------------------
-- Every proposal sends an email, a Discord post and an in-app notification.
-- The Edge Functions refuse both limits first with a friendlier error
-- (_shared/trade-limits.ts); this is the backstop, including for concurrent
-- proposals.
CREATE FUNCTION public.enforce_trade_offer_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.initiator_message IS DISTINCT FROM OLD.initiator_message)
    AND char_length(NEW.initiator_message) > 1500 THEN
    RAISE EXCEPTION 'Trade messages can be at most 1500 characters' USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.response_message IS DISTINCT FROM OLD.response_message)
    AND char_length(NEW.response_message) > 1500 THEN
    RAISE EXCEPTION 'Trade messages can be at most 1500 characters' USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.veto_reason IS DISTINCT FROM OLD.veto_reason)
    AND char_length(NEW.veto_reason) > 1500 THEN
    RAISE EXCEPTION 'Veto reasons can be at most 1500 characters' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status IN ('proposed', 'countered') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('trade_offer_cap:' || NEW.initiator_team_id::text, 0));
    IF (
      SELECT count(*) FROM public.trade_offers
      WHERE initiator_team_id = NEW.initiator_team_id
        AND status IN ('proposed', 'countered')
    ) >= 25 THEN
      RAISE EXCEPTION 'Your team already has 25 open trade offers. Cancel some before proposing more.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_trade_offer_limits
  BEFORE INSERT OR UPDATE OF initiator_message, response_message, veto_reason ON public.trade_offers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trade_offer_limits();

-- Validate the new CHECKs where existing data already passes them.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('public.league_series'::regclass, 'check_league_series_name_length'),
      ('public.wishlisted_movies'::regclass, 'check_wishlist_title_length'),
      ('public.wishlisted_movies'::regclass, 'check_wishlist_poster_url'),
      ('public.discord_channels'::regclass, 'check_discord_channel_id_lengths')
    ) AS v(tbl, con)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.con);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE '% on % left NOT VALID: existing rows exceed it', c.con, c.tbl;
    END;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.enforce_wishlist_cap(),
  public.enforce_discord_channel_cap(),
  public.enforce_pending_invitation_cap(),
  public.enforce_trade_offer_limits()
FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D13: retire process_score_queue()
-- ---------------------------------------------------------------------------
-- It read the service-role key from a database setting to call
-- process-movie-scores, which no longer exists. Its pg_cron job was removed in
-- 20260209_disable_scoring_pgcron.sql and nothing else calls it; scoring runs
-- through Vercel Cron -> update-scores.
DROP FUNCTION IF EXISTS public.process_score_queue();
