-- Join codes and tokens move off `leagues` into an owner-only table.
--
-- 20260206_add_shareable_join_links put join_code / join_token on `leagues`
-- with a comment saying only the owner could see them, but the `leagues`
-- SELECT policy covers every member and anyone with a pending invitation, so
-- they could all read the code. The owner is the only legitimate reader (the
-- join link card and settings section are owner-only; `join-league` and
-- `generate-join-link` use the service role).
--
-- Column grants on `leagues` (the discord_channels approach) would break every
-- `select('*')` on leagues, including clients still running the previous
-- bundle when this deploys. A separate table keeps `leagues` readable as-is.
--
-- The old columns stay, always NULL, so `start_next_season` (which copies a
-- `leagues` row and clears them) and old clients reading `*` keep working.
-- A later migration can drop them together with those references.

CREATE TABLE public.league_join_links (
  league_id uuid PRIMARY KEY REFERENCES public.leagues(id) ON DELETE CASCADE,
  join_code varchar(8) NOT NULL UNIQUE,
  join_token uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.league_join_links IS
  'Shareable join code per league. Readable by the league owner only; written by generate-join-link (service role).';

ALTER TABLE public.league_join_links ENABLE ROW LEVEL SECURITY;

-- Data API default privileges would otherwise give clients full DML here
-- (20260805190000_restore_data_api_default_grants).
REVOKE ALL ON TABLE public.league_join_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.league_join_links TO authenticated;
GRANT ALL ON TABLE public.league_join_links TO service_role;

CREATE POLICY "League owners can view their join link"
  ON public.league_join_links FOR SELECT TO authenticated
  USING (is_league_owner(league_id));

-- Existing codes keep working: copy them across before clearing the old columns.
INSERT INTO public.league_join_links (league_id, join_code, join_token)
SELECT id, join_code, COALESCE(join_token, gen_random_uuid())
FROM public.leagues
WHERE join_code IS NOT NULL;

UPDATE public.leagues
SET join_code = NULL, join_token = NULL
WHERE join_code IS NOT NULL OR join_token IS NOT NULL;

-- Nothing may write a code where members can read it again.
ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_join_columns_unused
  CHECK (join_code IS NULL AND join_token IS NULL);

COMMENT ON COLUMN public.leagues.join_code IS
  'Unused, always NULL. Join codes live in league_join_links (owner-only).';
COMMENT ON COLUMN public.leagues.join_token IS
  'Unused, always NULL. Join tokens live in league_join_links (owner-only).';

-- admin_growth_stats() (20261004120000) counted a league as "invited" when it
-- had a join token on `leagues`. Same definition, now read from the new table.
-- Unchanged otherwise; CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION public.admin_growth_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_since timestamptz := now() - interval '30 days';
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'admin_growth_stats: admin only' USING ERRCODE = '42501';
  END IF;

  WITH
  user_activity AS (
    SELECT
      u.id,
      u.created_at,
      u.raw_app_meta_data ->> 'provider' AS provider,
      GREATEST(
        u.last_sign_in_at,
        max(s.updated_at),
        max(s.refreshed_at AT TIME ZONE 'UTC')
      ) AS last_active_at
    FROM auth.users u
    LEFT JOIN auth.sessions s ON s.user_id = u.id
    GROUP BY u.id
  ),
  -- A league is a series; each leagues row is one season of it. The funnel
  -- follows each league's first season, so a rollover season (which inherits
  -- its players) is not counted as a new league that filled up instantly. The
  -- table shows each league's current season, by the same rule as
  -- currentSeasonOf() in apps/frontend/utils/seasons.ts.
  seasons AS (
    SELECT
      l.id,
      l.series_id,
      l.name,
      l.status,
      l.season_year,
      l.max_participants,
      l.created_at,
      l.owner_id,
      (SELECT count(*) FROM public.league_participants p
        WHERE p.league_id = l.id AND p.status = 'active') AS players,
      EXISTS (SELECT 1 FROM public.league_join_links j WHERE j.league_id = l.id)
        OR EXISTS (SELECT 1 FROM public.invitations i WHERE i.league_id = l.id) AS invited,
      row_number() OVER (PARTITION BY l.series_id ORDER BY l.season_year) AS season_number,
      row_number() OVER (
        PARTITION BY l.series_id ORDER BY l.status = 'completed', l.season_year DESC
      ) AS recency
    FROM public.leagues l
  ),
  first_seasons AS (SELECT * FROM seasons WHERE season_number = 1),
  current_seasons AS (SELECT * FROM seasons WHERE recency = 1),
  membership AS (
    SELECT p.user_id, s.series_id, s.players, s.status <> 'setup' AS drafted
    FROM public.league_participants p
    JOIN seasons s ON s.id = p.league_id
    WHERE p.status = 'active'
  ),
  months AS (
    SELECT generate_series(
      date_trunc('month', v_now) - interval '11 months',
      date_trunc('month', v_now),
      interval '1 month'
    ) AS month
  ),
  -- Every week since the first signup, for the running-total line chart.
  weeks AS (
    SELECT generate_series(
      date_trunc('week', (SELECT min(created_at) FROM user_activity)),
      date_trunc('week', v_now),
      interval '1 week'
    ) AS week
  )
  SELECT jsonb_build_object(
    'generated_at', v_now,

    'users', (
      SELECT jsonb_build_object(
        'total', count(*),
        'new_30d', count(*) FILTER (WHERE created_at >= v_since),
        'active_7d', count(*) FILTER (WHERE last_active_at >= v_now - interval '7 days'),
        'active_30d', count(*) FILTER (WHERE last_active_at >= v_since)
      )
      FROM user_activity
    ),

    'leagues', (
      SELECT jsonb_build_object(
        'total', count(*),
        'new_30d', count(*) FILTER (WHERE created_at >= v_since)
      )
      FROM first_seasons
    ),

    'rosters', (
      SELECT jsonb_build_object(
        'holdings', count(*),
        'drafted', count(*) FILTER (WHERE source = 'draft'),
        'picked_up', count(*) FILTER (WHERE source = 'pickup')
      )
      FROM public.team_holdings
    ),

    'monthly', (
      SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM-DD'),
        'signups', coalesce(u.n, 0),
        'leagues', coalesce(l.n, 0)
      ) ORDER BY m.month)
      FROM months m
      LEFT JOIN (
        SELECT date_trunc('month', created_at) AS month, count(*) AS n FROM user_activity GROUP BY 1
      ) u USING (month)
      LEFT JOIN (
        SELECT date_trunc('month', created_at) AS month, count(*) AS n FROM first_seasons GROUP BY 1
      ) l USING (month)
    ),

    'growth', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'week', to_char(g.week, 'YYYY-MM-DD'),
        'users', g.users,
        'leagues', g.leagues
      ) ORDER BY g.week), '[]'::jsonb)
      FROM (
        SELECT
          w.week,
          sum(coalesce(u.n, 0)) OVER (ORDER BY w.week) AS users,
          sum(coalesce(l.n, 0)) OVER (ORDER BY w.week) AS leagues
        FROM weeks w
        LEFT JOIN (
          SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM user_activity GROUP BY 1
        ) u USING (week)
        LEFT JOIN (
          SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM first_seasons GROUP BY 1
        ) l USING (week)
      ) g
    ),

    -- Each step counts leagues that reached it or went further, so the funnel
    -- never widens: a league that is drafting got a second player, even if one
    -- has since left.
    'league_funnel', (
      SELECT jsonb_build_object(
        'created', count(*),
        'invited', count(*) FILTER (WHERE invited OR players >= 2 OR status <> 'setup'),
        'second_player', count(*) FILTER (WHERE players >= 2 OR status <> 'setup'),
        'drafted', count(*) FILTER (WHERE status <> 'setup'),
        'live', count(*) FILTER (WHERE status IN ('active', 'completed'))
      )
      FROM first_seasons
    ),

    'user_funnel', (
      SELECT jsonb_build_object(
        'in_league', count(DISTINCT user_id),
        'with_others', count(DISTINCT user_id) FILTER (WHERE players >= 2),
        'drafted', count(DISTINCT user_id) FILTER (WHERE drafted)
      )
      FROM membership
    ),

    'activity', jsonb_build_object(
      'draft_picks', (
        SELECT jsonb_build_object('total', count(*), 'last_30d', count(*) FILTER (WHERE picked_at >= v_since))
        FROM public.draft_picks
      ),
      'pickups', (
        SELECT jsonb_build_object('total', count(*), 'last_30d', count(*) FILTER (WHERE picked_up_at >= v_since))
        FROM public.pickups
      ),
      'bids', (
        SELECT jsonb_build_object('total', count(*), 'last_30d', count(*) FILTER (WHERE created_at >= v_since))
        FROM (
          SELECT created_at FROM public.pickup_bids
          UNION ALL
          SELECT created_at FROM public.counterpick_bids
        ) b
      ),
      'counterpicks', (
        SELECT jsonb_build_object('total', count(*), 'last_30d', count(*) FILTER (WHERE created_at >= v_since))
        FROM public.counterpicks
      )
    ) || (
      SELECT jsonb_build_object(
        'trades_proposed', jsonb_build_object(
          'total', count(*),
          'last_30d', count(*) FILTER (WHERE proposed_at >= v_since)
        ),
        'trades_completed', jsonb_build_object(
          'total', count(*) FILTER (WHERE status = 'completed'),
          'last_30d', count(*) FILTER (WHERE status = 'completed' AND completed_at >= v_since)
        )
      )
      FROM public.trade_offers
    ),

    'league_list', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          c.id,
          c.name,
          pr.display_name AS owner,
          c.status,
          c.season_year,
          c.players,
          c.max_participants AS max_players,
          c.invited,
          f.created_at
        FROM current_seasons c
        JOIN first_seasons f USING (series_id)
        LEFT JOIN public.profiles pr ON pr.user_id = c.owner_id
        ORDER BY f.created_at DESC
        LIMIT 50
      ) r
    ),

    'recent_users', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.signed_up_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          ua.id,
          pr.display_name,
          ua.provider,
          ua.created_at AS signed_up_at,
          ua.last_active_at,
          coalesce(mc.leagues, 0) AS leagues
        FROM user_activity ua
        LEFT JOIN public.profiles pr ON pr.user_id = ua.id
        LEFT JOIN (
          SELECT user_id, count(DISTINCT series_id) AS leagues FROM membership GROUP BY user_id
        ) mc ON mc.user_id = ua.id
        ORDER BY ua.created_at DESC
        LIMIT 25
      ) r
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_stats() TO authenticated;
