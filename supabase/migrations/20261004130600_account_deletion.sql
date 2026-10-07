-- Account deletion that takes the account, and only the account.
--
-- Before this migration, deleting a user (there was no self-service path, so
-- that meant an admin in the Supabase dashboard) did two wrong things:
--
--   * It destroyed other people's data. leagues.owner_id and
--     league_series.owner_id were ON DELETE CASCADE, so deleting a
--     commissioner deleted every season they owned with every member's teams,
--     picks, bids, trades and history. league_participants.user_id cascaded
--     too, so even a plain member took their team with them -- and with it the
--     counterpicks other teams had made on their movies, and every trade they
--     had been part of.
--   * It left personal data behind: notification_log kept the recipient
--     email, final_standings kept the display name, and invitations sent to
--     the person's email address stayed.
--
-- Deletion now runs through handle_auth_user_deletion(), a BEFORE DELETE
-- trigger on auth.users, so the delete-account Edge Function, a dashboard
-- delete and merge-accounts all get the same treatment, in the same
-- transaction as the delete itself:
--
--   * Live drafts block deletion. A team that never picks would stall the
--     draft (there are no auto-picks), so the person finishes the draft first.
--   * Each season they own passes to the longest-standing other member, who
--     is told in the app; a season with nobody else in it (or only members
--     who were removed from it) is deleted. Each series they own follows its
--     newest season's owner, or is deleted once it has no seasons.
--   * Seasons still in setup simply lose the person, as if they had never
--     joined. In active and completed seasons the team and its roster stay,
--     so other teams' counterpicks on it and trades with it hold. The person
--     is marked 'left', which takes the team out of an active season's live
--     standings and final result (as for anyone who leaves mid-season) and
--     out of next season's rollover; a completed season's frozen result is
--     kept. Their pending bids and open trade offers are cancelled, and their
--     profile becomes an anonymous "Former member" with no photo.
--   * Their email is removed from notification_log and from invitations
--     addressed to it, and final_standings shows them as "Former member".
--
-- To make that possible the profile has to outlive the auth user, so
-- profiles.user_id and league_participants.user_id no longer reference
-- auth.users. The owner FKs become RESTRICT: if anything ever skips the
-- trigger, the delete fails rather than silently taking other people's leagues
-- with it.

-- ----------------------------------------------------------------------------
-- 1. Foreign keys
-- ----------------------------------------------------------------------------
ALTER TABLE public.leagues DROP CONSTRAINT leagues_owner_id_fkey;
ALTER TABLE public.leagues ADD CONSTRAINT leagues_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.league_series DROP CONSTRAINT league_series_owner_id_fkey;
ALTER TABLE public.league_series ADD CONSTRAINT league_series_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- A former member's participant row and profile stay behind (anonymized) so
-- the league they played in stays intact. league_participants still
-- references profiles(user_id), which is the FK every PostgREST embed uses.
ALTER TABLE public.league_participants DROP CONSTRAINT league_participants_user_id_fkey;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_user_id_fkey;

-- ON DELETE SET NULL is an UPDATE, and guard_season_activity rejects every
-- update to a completed season's trades, so deleting a commissioner who had
-- approved a trade failed outright. The id is meaningless once the account
-- is gone, so it no longer needs to resolve.
ALTER TABLE public.trade_offers DROP CONSTRAINT trade_offers_approved_by_fkey;

-- ----------------------------------------------------------------------------
-- 2. Notifications for a former member are dropped, not errors
-- ----------------------------------------------------------------------------
-- Sent to whoever inherits a season (section 5).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'league_ownership_transferred';

-- Former members are still participants, so batch notifications (season
-- started, bids processed, ...) include them. notifications.user_id still
-- references auth.users, and one dangling id would fail the whole batch insert.
CREATE OR REPLACE FUNCTION public.skip_notifications_for_deleted_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.skip_notifications_for_deleted_users() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER skip_notifications_for_deleted_users
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.skip_notifications_for_deleted_users();

-- ----------------------------------------------------------------------------
-- 3. Final standings: the only change allowed after completion
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_final_standings(p_standings JSONB, p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_agg(
    CASE WHEN e->>'user_id' = p_user_id::TEXT
      THEN jsonb_set(e, '{display_name}', '"Former member"')
      ELSE e
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(p_standings) WITH ORDINALITY AS x(e, ord)
$$;

-- Left executable by every role: guard_league_season() runs as the caller and
-- references it, and it only transforms the JSON it is given.

-- Unchanged from 20261003120000_league_double_points_over_90.sql except that a
-- completed season's final_standings may change when, and only when, the new
-- value is the old one with the account being deleted shown as "Former
-- member". app.deleting_user_id is set (transaction-local) only by
-- handle_auth_user_deletion(); even a caller who could set it could do no more
-- than anonymize that one person's name.
CREATE OR REPLACE FUNCTION guard_league_season()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleting_user UUID := NULLIF(current_setting('app.deleting_user_id', TRUE), '')::UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.series_id IS DISTINCT FROM OLD.series_id THEN
      RAISE EXCEPTION 'A season cannot change series' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'completed' AND (
      NEW.status IS DISTINCT FROM OLD.status OR
      NEW.season_year IS DISTINCT FROM OLD.season_year OR
      NEW.season_end IS DISTINCT FROM OLD.season_end OR
      NEW.double_points_over_90 IS DISTINCT FROM OLD.double_points_over_90 OR
      NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
      NEW.winner_team_ids IS DISTINCT FROM OLD.winner_team_ids OR
      (NEW.final_standings IS DISTINCT FROM OLD.final_standings AND (
        v_deleting_user IS NULL OR
        NEW.final_standings IS DISTINCT FROM anonymize_final_standings(OLD.final_standings, v_deleting_user)
      ))
    ) THEN
      RAISE EXCEPTION 'This season is finished.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF current_user IN ('anon', 'authenticated') THEN
    IF NOT EXISTS (
      SELECT 1 FROM league_series s
      WHERE s.id = NEW.series_id AND s.owner_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION 'Only the series owner can create its seasons' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'completed' OR NEW.completed_at IS NOT NULL
        OR NEW.winner_team_ids IS NOT NULL OR NEW.final_standings IS NOT NULL THEN
        RAISE EXCEPTION 'Season results are managed by completion' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.winner_team_ids IS DISTINCT FROM OLD.winner_team_ids
      OR NEW.final_standings IS DISTINCT FROM OLD.final_standings
      OR (NEW.status = 'completed' AND OLD.status <> 'completed') THEN
      RAISE EXCEPTION 'Season results are managed by completion' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. What blocks a deletion
-- ----------------------------------------------------------------------------
-- Seasons in a live draft the person is playing in or runs. The Edge Function
-- asks first so it can name them; the trigger re-checks under the delete.
CREATE OR REPLACE FUNCTION public.account_deletion_blockers(p_user_id UUID)
RETURNS TABLE (league_id UUID, league_name TEXT)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT l.id, l.name::TEXT
  FROM public.leagues l
  WHERE l.status IN ('drafting', 'counterpicking')
    AND (
      l.owner_id = p_user_id
      OR EXISTS (
        SELECT 1 FROM public.league_participants lp
        WHERE lp.league_id = l.id AND lp.user_id = p_user_id AND lp.status = 'active'
      )
    )
  ORDER BY l.name
$$;

REVOKE ALL ON FUNCTION public.account_deletion_blockers(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_blockers(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. The deletion itself
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_auth_user_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := OLD.id;
  -- merge-accounts deletes a duplicate account that shares the original's
  -- email. Data addressed to that email belongs to the account that stays.
  v_email TEXT := CASE
    WHEN OLD.email IS NULL OR EXISTS (
      SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(OLD.email) AND u.id <> OLD.id
    ) THEN NULL
    ELSE lower(OLD.email)
  END;
  v_blocker TEXT;
  v_league RECORD;
  v_new_owner UUID;
  v_series RECORD;
BEGIN
  PERFORM set_config('app.deleting_user_id', v_user_id::TEXT, TRUE);

  -- Lock the seasons this touches before deciding anything, so a draft cannot
  -- start between the check and the changes below.
  PERFORM 1 FROM leagues l
  WHERE l.owner_id = v_user_id
     OR l.id IN (SELECT lp.league_id FROM league_participants lp WHERE lp.user_id = v_user_id)
  ORDER BY l.id
  FOR UPDATE;

  SELECT string_agg(b.league_name, ', ') INTO v_blocker
  FROM account_deletion_blockers(v_user_id) b;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'Finish the draft in % before deleting this account', v_blocker
      USING ERRCODE = 'PT409';
  END IF;

  -- Seasons they own: hand each to the longest-standing other member, or
  -- delete it when nobody else ever played in it.
  FOR v_league IN SELECT l.id, l.name, l.status FROM leagues l WHERE l.owner_id = v_user_id LOOP
    SELECT lp.user_id INTO v_new_owner
    FROM league_participants lp
    WHERE lp.league_id = v_league.id
      AND lp.user_id <> v_user_id
      -- Someone who left can still open the season; someone removed cannot,
      -- so a season left with only removed members is deleted instead.
      AND lp.status IN ('active', 'left')
      -- A former member is not an owner.
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = lp.user_id)
    ORDER BY (lp.status = 'active') DESC, lp.joined_at, lp.id
    LIMIT 1;

    IF v_new_owner IS NULL THEN
      DELETE FROM leagues WHERE id = v_league.id;
    ELSE
      UPDATE leagues SET owner_id = v_new_owner WHERE id = v_league.id;
      UPDATE league_participants SET role = 'owner'
      WHERE league_id = v_league.id AND user_id = v_new_owner;

      -- A finished season has nothing left to run.
      IF v_league.status <> 'completed' THEN
        INSERT INTO notifications (user_id, league_id, type, title, body)
        VALUES (
          v_new_owner, v_league.id, 'league_ownership_transferred',
          format('You now run %s', v_league.name),
          format('The commissioner of %s deleted their account, so the league passed to you.', v_league.name)
        );
      END IF;
    END IF;
  END LOOP;

  FOR v_series IN SELECT s.id FROM league_series s WHERE s.owner_id = v_user_id LOOP
    SELECT l.owner_id INTO v_new_owner
    FROM leagues l WHERE l.series_id = v_series.id
    ORDER BY l.season_year DESC LIMIT 1;

    IF v_new_owner IS NULL THEN
      DELETE FROM league_series WHERE id = v_series.id;
    ELSE
      UPDATE league_series SET owner_id = v_new_owner WHERE id = v_series.id;
    END IF;
  END LOOP;

  -- Seasons in setup have nothing to preserve: leave as if never joined.
  -- Pending join rows go everywhere.
  UPDATE leagues SET custom_draft_order = FALSE
  WHERE status = 'setup'
    AND id IN (SELECT lp.league_id FROM league_participants lp WHERE lp.user_id = v_user_id);
  DELETE FROM league_participants lp
  USING leagues l
  WHERE lp.league_id = l.id
    AND lp.user_id = v_user_id
    AND (l.status = 'setup' OR lp.status = 'pending');

  -- Active and completed seasons keep the team. Stop what is still in flight.
  UPDATE pickup_bids b SET status = 'cancelled', resolution_reason = 'user_cancelled'
  FROM teams t JOIN league_participants lp ON lp.id = t.participant_id
  WHERE b.team_id = t.id AND lp.user_id = v_user_id AND b.status IN ('active', 'outbid');

  UPDATE counterpick_bids b SET status = 'cancelled', resolution_reason = 'user_cancelled'
  FROM teams t JOIN league_participants lp ON lp.id = t.participant_id
  WHERE b.team_id = t.id AND lp.user_id = v_user_id AND b.status IN ('active', 'outbid');

  UPDATE trade_offers o SET status = 'cancelled'
  FROM teams t JOIN league_participants lp ON lp.id = t.participant_id
  WHERE lp.user_id = v_user_id
    AND t.id IN (o.initiator_team_id, o.recipient_team_id)
    AND o.status IN ('proposed', 'countered', 'accepted', 'review');

  UPDATE teams t SET avatar_url = NULL
  FROM league_participants lp
  WHERE lp.id = t.participant_id AND lp.user_id = v_user_id AND t.avatar_url IS NOT NULL;

  UPDATE league_participants SET status = 'left', role = 'member'
  WHERE user_id = v_user_id AND status = 'active';

  UPDATE leagues
  SET final_standings = anonymize_final_standings(final_standings, v_user_id)
  WHERE final_standings @> jsonb_build_array(jsonb_build_object('user_id', v_user_id::TEXT));

  -- Personal data that outlives the account.
  DELETE FROM notification_log
  WHERE recipient_user_id = v_user_id
     OR (v_email IS NOT NULL AND lower(recipient_email) = v_email);

  DELETE FROM invitations
  WHERE invited_user_id = v_user_id
     OR (v_email IS NOT NULL AND lower(email) = v_email);

  IF EXISTS (SELECT 1 FROM league_participants WHERE user_id = v_user_id) THEN
    UPDATE profiles
    SET display_name = 'Former member', avatar_url = NULL, wishlist_public = FALSE
    WHERE user_id = v_user_id;
  ELSE
    DELETE FROM profiles WHERE user_id = v_user_id;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_deletion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deletion();

-- ----------------------------------------------------------------------------
-- 6. A deleted account's leftover session cannot undo the anonymizing
-- ----------------------------------------------------------------------------
-- Deleting the auth user does not revoke access tokens already issued, so for
-- up to an hour the person's token still passes the "own row" UPDATE policies
-- on profiles and teams, which would let them put their name and photo back on
-- the "Former member" row. Service-role and auth-admin writes carry no
-- auth.uid() and are unaffected.
CREATE OR REPLACE FUNCTION public.reject_writes_from_deleted_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_caller) THEN
    RAISE EXCEPTION 'This account has been deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_writes_from_deleted_accounts() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER reject_writes_from_deleted_accounts
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reject_writes_from_deleted_accounts();

CREATE TRIGGER reject_writes_from_deleted_accounts
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.reject_writes_from_deleted_accounts();
