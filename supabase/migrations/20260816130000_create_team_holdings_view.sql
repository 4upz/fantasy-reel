-- ============================================================================
-- ONE READ SURFACE FOR "WHAT DOES A TEAM CURRENTLY HOLD"
-- ============================================================================
--
-- A roster is split across two tables by provenance: `draft_picks` (drafted)
-- and `pickups` (won at auction). They carry the same league_id / team_id /
-- movie_id / dropped_at / counterpicked_by_team_id, and differ only in how the
-- movie was acquired. Every reader therefore has to UNION them and filter
-- `dropped_at IS NULL` -- and readers keep forgetting one or the other. The
-- scoring functions lost the pickups leg once already (issue #17,
-- 20260728164550), and update-scores' league branch still reads draft_picks
-- alone.
--
-- `team_holdings` closes that class of bug by construction:
--
--   * Both legs are always present, so no reader can forget one.
--   * Both legs filter `dropped_at IS NULL` and the column is NOT exposed.
--     The view's contract is "what the team holds right now"; there is no
--     dropped row to accidentally include.
--   * teams and movies are denormalized in. PostgREST cannot resolve FK
--     embeds through a UNION view, so a `teams(name)` embed would fail --
--     joining here is what makes the view usable from the Data API at all.
--     That applies to the counterpicking team too, hence counterpicked_by_name
--     alongside counterpicked_by_team_id, and to the full movie column set, so
--     `movies(*)` consumers can migrate without a supplemental query.
--
-- Consumers that legitimately need dropped rows (score-notifications' D2
-- "notable miss" attribution) must keep reading the base tables directly.
--
-- security_invoker: base-table RLS still applies, so this exposes nothing a
-- caller could not already select from draft_picks / pickups / teams / movies.
-- ============================================================================

-- Dropped rather than replaced: CREATE OR REPLACE VIEW can only append
-- columns, and this defines the column set from scratch.
DROP VIEW IF EXISTS public.team_holdings;

CREATE VIEW public.team_holdings
WITH (security_invoker = true) AS
    SELECT
        dp.id                       AS holding_id,
        'draft'::TEXT               AS source,
        dp.league_id,
        dp.team_id,
        dp.movie_id,
        dp.picked_at                AS acquired_at,
        dp.counterpicked_by_team_id,
        cbt.name                    AS counterpicked_by_name,
        dp.round,
        dp.pick_number,
        NULL::UUID                  AS bid_id,
        NULL::INTEGER               AS amount_paid,
        t.name                      AS team_name,
        m.tmdb_id,
        m.title,
        m.release_date,
        m.poster_url,
        m.status                    AS movie_status,
        m.imdb_id,
        m.combined_score,
        m.fantasy_points,
        m.overview,
        m.backdrop_url,
        m.vote_average,
        m.vote_count,
        m.popularity,
        m.scoring_bonuses,
        m.scores_updated_at
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN movies m ON m.id = dp.movie_id
    -- LEFT: most holdings are not counterpicked, and those rows must survive.
    LEFT JOIN teams cbt ON cbt.id = dp.counterpicked_by_team_id
    WHERE dp.dropped_at IS NULL

    UNION ALL

    SELECT
        pk.id                       AS holding_id,
        'pickup'::TEXT              AS source,
        pk.league_id,
        pk.team_id,
        pk.movie_id,
        pk.picked_up_at             AS acquired_at,
        pk.counterpicked_by_team_id,
        cbt.name                    AS counterpicked_by_name,
        NULL::INTEGER               AS round,
        NULL::INTEGER               AS pick_number,
        pk.bid_id,
        pk.amount_paid,
        t.name                      AS team_name,
        m.tmdb_id,
        m.title,
        m.release_date,
        m.poster_url,
        m.status                    AS movie_status,
        m.imdb_id,
        m.combined_score,
        m.fantasy_points,
        m.overview,
        m.backdrop_url,
        m.vote_average,
        m.vote_count,
        m.popularity,
        m.scoring_bonuses,
        m.scores_updated_at
    FROM pickups pk
    JOIN teams t ON t.id = pk.team_id
    JOIN movies m ON m.id = pk.movie_id
    LEFT JOIN teams cbt ON cbt.id = pk.counterpicked_by_team_id
    WHERE pk.dropped_at IS NULL;

COMMENT ON VIEW public.team_holdings IS
'Single read surface for active team rosters: drafted movies (draft_picks) plus auction wins (pickups), both filtered to dropped_at IS NULL, with the holding team, the counterpicking team, and the full movie row denormalized in for PostgREST. Read-only -- writes still go to the base tables. Readers needing dropped rows must query the base tables directly.';

GRANT SELECT ON public.team_holdings TO authenticated, service_role;

-- ============================================================================
-- team_active_roster now reads the view
-- ============================================================================
-- Same signature and return shape, so the scoring functions that call it
-- (recalculate_team_score_with_counterpicks and friends) are untouched. It
-- stays SECURITY INVOKER: called from inside those SECURITY DEFINER functions
-- it runs as the definer and sees everything, while a direct call from a user
-- is still constrained by the base tables' RLS.
-- ============================================================================

CREATE OR REPLACE FUNCTION team_active_roster(p_team_id UUID)
RETURNS TABLE(movie_id UUID, source TEXT) AS $$
    SELECT th.movie_id, th.source
    FROM team_holdings th
    WHERE th.team_id = p_team_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION team_active_roster(UUID) IS
'Movies a team currently holds, by acquisition source. Thin wrapper over the team_holdings view, which excludes dropped draft picks and dropped pickups.';
