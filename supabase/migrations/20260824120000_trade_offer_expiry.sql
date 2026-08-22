-- ============================================================================
-- Per-offer trade expiry
--
-- Renumbered twice, and both times for the same reason: schema_migrations is
-- keyed on version, so a duplicate version silently marks this migration
-- applied and the expiry feature goes missing with no error.
--   20260820120000 -> collided with pickup_bid_priority_and_conditional_drops
--                     (now on main) and lock_down_account_lookups_and_profiles
--                     (still in flight).
--   20260823120000 -> collided with trade_errors_name_the_movie (now on main).
-- Keep this dated after every migration on main when rebasing.
--
-- Lets a proposer put a clock on a trade offer: it lapses on its own if the
-- recipient never answers. See docs/PLAN-trade-offer-expiry.md.
--
-- Three clocks now exist on a trade and must not be confused:
--   leagues.trade_deadline   -- season-level, last date a trade may happen
--   trade_offers.review_ends_at -- post-accept commissioner veto window
--   trade_offers.expires_at  -- THIS: how long an unanswered offer stands
--
-- Enforcement is two-layered. This file is layer 1: the authoritative check
-- lives inside respond_to_trade()/counter_trade(), under the row lock they
-- already take, so a late or wedged cron can never let a lapsed offer through.
-- Layer 2 (process-trades) only materializes status and sends notifications.
-- ============================================================================

-- ============================================================================
-- PART 1: Columns
-- ============================================================================

ALTER TABLE trade_offers
  ADD COLUMN IF NOT EXISTS expires_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_anchor           TEXT,
  ADD COLUMN IF NOT EXISTS expiry_anchor_movie_id  UUID REFERENCES movies(id),
  ADD COLUMN IF NOT EXISTS expired_reason          TEXT;

ALTER TABLE trade_offers
  ADD CONSTRAINT check_expiry_anchor_value
    CHECK (expiry_anchor IS NULL OR expiry_anchor IN ('fixed', 'movie_release')),
  -- A movie-anchored offer names the movie it waits on; a fixed one never does.
  ADD CONSTRAINT check_expiry_anchor_movie_paired
    CHECK ((expiry_anchor = 'movie_release') = (expiry_anchor_movie_id IS NOT NULL)),
  ADD CONSTRAINT check_expired_reason_value
    CHECK (expired_reason IS NULL
           OR expired_reason IN ('offer_window', 'movie_released', 'league_deadline')),
  -- An offer either has a clock and a record of where it came from, or neither.
  -- Existing rows backfill to (NULL, NULL) and satisfy this.
  ADD CONSTRAINT check_expiry_anchor_paired
    CHECK ((expires_at IS NULL) = (expiry_anchor IS NULL));

COMMENT ON COLUMN trade_offers.expires_at IS
  'When this unanswered offer lapses. NULL = stands forever (the pre-expiry behavior, and what every offer created before this migration keeps). Always a resolved timestamp regardless of how the proposer picked it.';
COMMENT ON COLUMN trade_offers.expiry_anchor IS
  'How expires_at was derived: "fixed" (preset or custom time, never moves) or "movie_release" (waits on expiry_anchor_movie_id, re-resolved by process-trades when that movie''s release date shifts).';
COMMENT ON COLUMN trade_offers.expiry_anchor_movie_id IS
  'The movie a "movie_release" offer waits on. The proposer picks any unreleased movie in the offer -- not necessarily the earliest -- so this is stored rather than re-derived. Storing it also means a date shift moves THIS offer''s clock instead of silently switching which movie owns the anchor.';
COMMENT ON COLUMN trade_offers.expired_reason IS
  'Why an expired offer expired: offer_window (its clock ran out), movie_released (its release anchor arrived), league_deadline (the season trade deadline passed). NULL on offers expired for other reasons -- those carry veto_reason instead, which is what execute_trade and the process-trades revalidation path already write.';
COMMENT ON COLUMN trade_offers.expiry_reminder_sent_at IS
  'Reserved for the "expiring soon" nudge (Phase 2 of docs/PLAN-trade-offer-expiry.md): when the single nudge was sent, so overlapping cron runs cannot double-send. Nothing reads it yet. It is written now -- reset to NULL wherever the clock is reset -- so adding the nudge does not mean reopening counter_trade() and reresolve_release_anchored_offers().';

-- Supports the sweep. The predicate is a strict SUBSET of the "open offer"
-- status list hardcoded in get_contested_source_ids, execute_trade and the two
-- partial indexes in 20260809120000 -- it does not redefine open-ness, so the
-- "change all four together" rule there is untouched.
CREATE INDEX IF NOT EXISTS idx_trade_offers_pending_expiry
  ON trade_offers (expires_at)
  WHERE status IN ('proposed', 'countered') AND expires_at IS NOT NULL;

-- Supports release re-resolution, which scans open release-anchored offers and
-- filters on nothing else. The partial predicate IS the point, so the key is
-- the primary key rather than a column the query never touches.
CREATE INDEX IF NOT EXISTS idx_trade_offers_release_anchored
  ON trade_offers (id)
  WHERE status IN ('proposed', 'countered') AND expiry_anchor = 'movie_release';

-- ============================================================================
-- PART 2: Release-anchor resolution
--
-- "Expires when X releases" resolves to the EARLIEST release among the movies
-- on BOTH sides: once any movie in the deal is out, the information balance
-- has already changed, so that is when the offer should stop standing.
--
-- The boundary matches isUpcomingMovie() in _shared/utils.ts, which treats a
-- movie as upcoming while release_date >= today (UTC) -- i.e. it becomes
-- released at the START of the day AFTER its release date. Using the same
-- boundary keeps one definition of "released" in the codebase.
--
-- Resolution reads movies.release_date LIVE. The release_date inside the offer's
-- items JSONB is a snapshot taken by enrichTradeItems at proposal time and
-- drifts whenever sync-release-dates moves a date; it is display data only.
-- ============================================================================

-- The instant one movie stops counting as upcoming. NULL if it has no release
-- date. Reads movies.release_date live, never the items JSONB snapshot.
CREATE OR REPLACE FUNCTION movie_release_boundary(p_movie_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT (m.release_date + INTERVAL '1 day') AT TIME ZONE 'UTC'
  FROM movies m
  WHERE m.id = p_movie_id AND m.release_date IS NOT NULL
$$;

COMMENT ON FUNCTION movie_release_boundary(UUID) IS
  'When a movie stops counting as upcoming: the start of the day after its release_date, UTC. Same boundary as isUpcomingMovie() in _shared/utils.ts, so the codebase keeps one definition of "released".';

/**
 * The movies in an offer that could anchor its expiry: still unreleased, with a
 * known date, ordered soonest first.
 *
 * Every unreleased movie qualifies -- not just the earliest. A trade often
 * bundles one film that is nearly out with another months away, and which of
 * them the deal actually hinges on is the proposer's call, not the schedule's.
 * The first row is the default.
 */
CREATE OR REPLACE FUNCTION offer_anchor_candidates(
  p_initiator_items JSONB,
  p_recipient_items JSONB
)
RETURNS TABLE (movie_id UUID, title TEXT, release_date DATE, boundary TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT DISTINCT m.id, m.title, m.release_date,
         (m.release_date + INTERVAL '1 day') AT TIME ZONE 'UTC'
  FROM (
    SELECT value FROM jsonb_array_elements(COALESCE(p_initiator_items->'movies', '[]'::jsonb))
    UNION ALL
    SELECT value FROM jsonb_array_elements(COALESCE(p_recipient_items->'movies', '[]'::jsonb))
  ) AS item
  JOIN movies m ON m.id = (item.value->>'movie_id')::UUID
  WHERE m.release_date IS NOT NULL
    AND (m.release_date + INTERVAL '1 day') AT TIME ZONE 'UTC' > now()
  ORDER BY 3, 2
$$;

COMMENT ON FUNCTION offer_anchor_candidates(JSONB, JSONB) IS
  'Unreleased movies in a trade offer, soonest first -- the choices for a movie_release expiry, with the first row as the default. Deliberately not restricted to the earliest: the proposer picks which release the deal hinges on.';

REVOKE EXECUTE ON FUNCTION movie_release_boundary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION movie_release_boundary(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION offer_anchor_candidates(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION offer_anchor_candidates(JSONB, JSONB) TO authenticated, service_role;

-- ============================================================================
-- PART 3: respond_to_trade -- reject a lapsed offer under the row lock
--
-- Carried forward verbatim from 20260132_trading_race_condition_fixes.sql; the
-- only addition is the expiry check marked below.
-- ============================================================================

CREATE OR REPLACE FUNCTION respond_to_trade(
  p_trade_id UUID,
  p_response TEXT,  -- 'accept' or 'reject'
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_league RECORD;
  v_review_ends_at TIMESTAMPTZ;
  v_new_status TEXT;
  v_error TEXT;
BEGIN
  -- Lock and fetch the trade
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status NOT IN ('proposed', 'countered') THEN
    RETURN jsonb_build_object(
      'error', format('Cannot respond to a trade with status "%s"', v_trade.status),
      'status_code', 400
    );
  END IF;

  -- ADDED: the authoritative expiry guard. The sweep in process-trades runs
  -- every 5 minutes, so an offer can be past its clock while still sitting in
  -- 'proposed'. Rejecting here -- inside the lock, before any validation or
  -- state change -- is what makes cron lag harmless. A REJECT is still allowed:
  -- declining something already dead costs nothing and avoids a confusing error.
  IF p_response = 'accept'
     AND v_trade.expires_at IS NOT NULL
     AND v_trade.expires_at <= now() THEN
    RETURN jsonb_build_object('error', 'This offer has expired', 'status_code', 400);
  END IF;

  IF p_response = 'reject' THEN
    UPDATE trade_offers
    SET status = 'rejected'::trade_status,
        responded_at = now(),
        response_message = NULLIF(trim(p_message), '')
    WHERE id = p_trade_id;

    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  -- Accept: re-validate trade items
  v_error := validate_trade_items(v_trade.initiator_team_id, v_trade.initiator_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Initiator validation failed: ' || v_error, 'status_code', 400);
  END IF;

  v_error := validate_trade_items(v_trade.recipient_team_id, v_trade.recipient_items);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Recipient validation failed: ' || v_error, 'status_code', 400);
  END IF;

  -- Get league config
  SELECT trade_veto_hours, trade_review_enabled
  INTO v_league
  FROM leagues
  WHERE id = v_trade.league_id;

  IF v_league.trade_review_enabled AND v_league.trade_veto_hours > 0 THEN
    v_new_status := 'review';
    v_review_ends_at := now() + (v_league.trade_veto_hours || ' hours')::INTERVAL;
  ELSE
    v_new_status := 'accepted';
    v_review_ends_at := NULL;
  END IF;

  UPDATE trade_offers
  SET status = v_new_status::trade_status,
      responded_at = now(),
      accepted_at = now(),
      review_ends_at = v_review_ends_at,
      response_message = NULLIF(trim(p_message), '')
  WHERE id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'review_ends_at', v_review_ends_at
  );
END;
$$;

COMMENT ON FUNCTION respond_to_trade IS
  'Atomically responds to a trade with proper row-level locking. Refuses to accept an offer past its expires_at, whether or not the sweep has caught it yet.';

-- ============================================================================
-- PART 4: counter_trade -- reject a lapsed offer, and RESET the clock
--
-- counter_trade updates the offer row IN PLACE (the role swap documented in
-- counter-trade/index.ts), so without this the countered offer would inherit
-- the original proposer's clock: counter a 48h offer at hour 47 and it dies a
-- minute later. The counterer picks a fresh window, exactly as a proposer does.
--
-- The parameter list changes, so the old 6-argument version must be dropped --
-- CREATE OR REPLACE cannot add parameters, and leaving both would make the
-- named-argument call from counter-trade ambiguous.
-- ============================================================================

DROP FUNCTION IF EXISTS counter_trade(UUID, UUID, UUID, JSONB, JSONB, TEXT);

CREATE FUNCTION counter_trade(
  p_trade_id UUID,
  p_new_initiator_team_id UUID,
  p_new_recipient_team_id UUID,
  p_new_initiator_items JSONB,
  p_new_recipient_items JSONB,
  p_message TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_expiry_anchor TEXT DEFAULT NULL,
  p_expiry_anchor_movie_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade trade_offers;
  v_expires_at TIMESTAMPTZ := p_expires_at;
BEGIN
  -- Lock and fetch the trade
  v_trade := get_trade_offer_for_update(p_trade_id);

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade not found', 'status_code', 404);
  END IF;

  IF v_trade.status NOT IN ('proposed', 'countered') THEN
    RETURN jsonb_build_object(
      'error', format('Cannot counter a trade with status "%s"', v_trade.status),
      'status_code', 400
    );
  END IF;

  -- Same authoritative guard as respond_to_trade: a lapsed offer is done, and
  -- countering it would resurrect a dead row rather than starting a new deal.
  IF v_trade.expires_at IS NOT NULL AND v_trade.expires_at <= now() THEN
    RETURN jsonb_build_object('error', 'This offer has expired', 'status_code', 400);
  END IF;

  IF p_expiry_anchor IS NOT NULL AND p_expiry_anchor NOT IN ('fixed', 'movie_release') THEN
    RETURN jsonb_build_object('error', 'Invalid expiry anchor', 'status_code', 400);
  END IF;

  IF (p_expiry_anchor = 'movie_release') <> (p_expiry_anchor_movie_id IS NOT NULL) THEN
    RETURN jsonb_build_object(
      'error', 'A release-anchored offer must name the movie it waits on',
      'status_code', 400
    );
  END IF;

  -- The expiry arrives already resolved, bounded and clamped by
  -- resolveOfferExpiry() in _shared/trade-expiry.ts, which is the single place
  -- those rules live for both write paths (propose inserts its result directly).
  -- This function deliberately does NOT re-resolve a release anchor: it would
  -- resolve the same items to the same instant, but bare -- throwing away the
  -- min/max window check and the league-deadline clamp the resolver applied.
  IF (v_expires_at IS NULL) <> (p_expiry_anchor IS NULL) THEN
    RETURN jsonb_build_object('error', 'Expiry and expiry anchor must be set together', 'status_code', 400);
  END IF;

  -- Update the trade with counter-offer
  UPDATE trade_offers
  SET status = 'countered'::trade_status,
      initiator_team_id = p_new_initiator_team_id,
      recipient_team_id = p_new_recipient_team_id,
      initiator_items = p_new_initiator_items,
      recipient_items = p_new_recipient_items,
      responded_at = now(),
      accepted_at = NULL,
      review_ends_at = NULL,
      response_message = NULLIF(trim(p_message), ''),
      -- The counter is a new offer wearing the old row: new clock, new anchor,
      -- and the "expiring soon" nudge becomes available again.
      expires_at = v_expires_at,
      expiry_anchor = p_expiry_anchor,
      expiry_anchor_movie_id = p_expiry_anchor_movie_id,
      expiry_reminder_sent_at = NULL
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires_at);
END;
$$;

COMMENT ON FUNCTION counter_trade IS
  'Atomically counters a trade with proper row-level locking. Resets the offer expiry to the counterer''s choice -- the row is reused, so an inherited clock would lapse the counter early. Refuses to counter an already-lapsed offer.';

REVOKE EXECUTE ON FUNCTION counter_trade(UUID, UUID, UUID, JSONB, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION counter_trade(UUID, UUID, UUID, JSONB, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID)
  TO service_role;

-- ============================================================================
-- PART 5: Re-resolve release-anchored offers
--
-- Release dates move -- that is what the sync-release-dates cron exists for --
-- so a movie_release offer's expires_at has to follow. Only open offers: an
-- accepted offer's clock belongs to the review window, and re-resolving it
-- would silently change an agreed deal.
--
-- Returns only the offers whose expiry actually moved, so the caller can notify
-- exactly those parties.
-- ============================================================================

CREATE OR REPLACE FUNCTION reresolve_release_anchored_offers()
RETURNS TABLE (
  id UUID,
  league_id UUID,
  initiator_team_id UUID,
  recipient_team_id UUID,
  initiator_items JSONB,
  recipient_items JSONB,
  previous_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved AS (
    -- Follows the movie the offer named, not whichever is earliest now. An
    -- offer that said "until Dune 3 opens" keeps meaning that even if another
    -- movie in the deal is rescheduled ahead of it.
    SELECT t.id,
           t.expires_at AS previous_expires_at,
           movie_release_boundary(t.expiry_anchor_movie_id) AS new_expires_at
    FROM trade_offers t
    WHERE t.status IN ('proposed', 'countered')
      AND t.expiry_anchor = 'movie_release'
  ),
  moved AS (
    -- A resolution of NULL means every movie lost its release date, which TMDb
    -- does when a film is pulled from the schedule. Leave the existing clock
    -- alone rather than dropping to "never expires" (which the paired CHECK
    -- would reject anyway) or expiring the offer on a data blip.
    SELECT resolved.id, resolved.previous_expires_at, resolved.new_expires_at
    FROM resolved
    -- Every reference here is qualified on purpose: the RETURNS TABLE output
    -- names (id, expires_at, previous_expires_at, ...) are parameters in a
    -- LANGUAGE sql body, and an unqualified match would be ambiguous.
    WHERE resolved.new_expires_at IS NOT NULL
      AND resolved.new_expires_at IS DISTINCT FROM resolved.previous_expires_at
  )
  UPDATE trade_offers t
  SET expires_at = moved.new_expires_at,
      -- The window changed, so a nudge already sent described a time that is no
      -- longer true. Let it be sent again against the new one.
      expiry_reminder_sent_at = NULL,
      updated_at = now()
  FROM moved
  WHERE t.id = moved.id
  RETURNING t.id, t.league_id, t.initiator_team_id, t.recipient_team_id,
            t.initiator_items, t.recipient_items,
            moved.previous_expires_at, t.expires_at;
$$;

COMMENT ON FUNCTION reresolve_release_anchored_offers() IS
  'Recomputes expires_at for open release-anchored offers from live movies.release_date, returning only the offers whose expiry moved. Run before the expiry sweep so a movie that moved earlier expires in the same pass.';

REVOKE EXECUTE ON FUNCTION reresolve_release_anchored_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reresolve_release_anchored_offers() TO service_role;

-- ============================================================================
-- PART 6: The expiry sweep
--
-- Claims and flips in ONE statement, so two overlapping cron runs cannot both
-- claim a row and double-notify: only the rows RETURNING hands back get a
-- notification. now() is the database's -- every other clock on a trade
-- (review_ends_at, accepted_at) is DB time, and mixing sources invites
-- skew disputes.
--
-- Deliberately unbounded: expiry is one UPDATE, unlike the execution loop it
-- runs alongside, and a league that let 40 offers pile up should not need 20
-- minutes of cron runs to clear them.
-- ============================================================================

CREATE OR REPLACE FUNCTION expire_lapsed_trade_offers()
RETURNS SETOF trade_offers
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Two statements rather than one with an OR. The two conditions live on
  -- different relations, and Postgres cannot build a BitmapOr across a join --
  -- a combined predicate would scan every open offer and filter. Split, the
  -- first drives off idx_trade_offers_pending_expiry and the second off
  -- idx_trade_offers_league_open.
  --
  -- Both statements claim and flip in one shot, so two overlapping cron runs
  -- cannot both claim a row; the caller notifies exactly what it gets back.
  -- The second cannot re-claim what the first took: the first leaves those
  -- rows in 'expired'.

  -- 1. The offer's own clock ran out.
  RETURN QUERY
  UPDATE trade_offers t
  SET status = 'expired'::trade_status,
      expired_reason =
        CASE WHEN t.expiry_anchor = 'movie_release' THEN 'movie_released' ELSE 'offer_window' END,
      updated_at = now()
  -- Only an unanswered offer has a clock. Once both parties agree, the review
  -- window owns the trade. Kept in step with idx_trade_offers_pending_expiry,
  -- reresolve_release_anchored_offers() and EXPIRY_RELEVANT_STATUSES in
  -- TradeOfferCard.tsx -- change the four together.
  WHERE t.status IN ('proposed', 'countered')
    AND t.expires_at IS NOT NULL
    AND t.expires_at <= now()
  RETURNING t.*;

  -- 2. The league's season deadline passed. An offer that outlives it can never
  -- be accepted -- validateTradeProposal re-checks it -- so lapse it here
  -- rather than letting it die later with a confusing error. Deadline day is
  -- inclusive, as in validateLeagueTradingEnabled; unlike that check, the day
  -- ends in UTC rather than whatever locale the Edge Function runs in.
  RETURN QUERY
  UPDATE trade_offers t
  SET status = 'expired'::trade_status,
      expired_reason = 'league_deadline',
      updated_at = now()
  FROM leagues l
  WHERE l.id = t.league_id
    AND t.status IN ('proposed', 'countered')
    AND l.trade_deadline IS NOT NULL
    AND now() >= ((l.trade_deadline + INTERVAL '1 day') AT TIME ZONE 'UTC')
  RETURNING t.*;
END;
$$;

COMMENT ON FUNCTION expire_lapsed_trade_offers() IS
  'Expires open offers whose clock ran out (offer_window / movie_released) or whose league trade deadline passed (league_deadline). Claims and flips in one statement so overlapping cron runs cannot double-notify; the caller notifies exactly the returned rows.';

REVOKE EXECUTE ON FUNCTION expire_lapsed_trade_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_lapsed_trade_offers() TO service_role;
