-- Growth metrics for the app's own admin page (/admin).
--
-- Vercel Analytics sees page views and product events but not who signed up,
-- who came back, or how far a league got before it stalled. That all lives in
-- the database, so the page reads it through one RPC.
--
-- app_admins lists who may call it. It is its own table rather than a flag on
-- profiles so that no RLS policy or profile read can ever expose it, and
-- nothing else in the app has a reason to branch on it.

CREATE TABLE public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_admins FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_admins TO service_role;

-- The app owner's production account, pinned by id rather than email: on a
-- fresh database (a preview branch, a rebuilt project) an email match would
-- make whoever signed up with that address first an admin. Inserts nothing
-- where the account doesn't exist (local and CI, where seed.sql makes Alice an
-- admin instead). Add another admin with a service-role insert of their
-- auth.users id; no migration needed.
INSERT INTO public.app_admins (user_id)
SELECT id FROM auth.users WHERE id = '3c634b1b-1c1d-4a79-bb47-b6f26621a731'
ON CONFLICT DO NOTHING;

-- One JSON document with everything /admin renders. Anyone not in app_admins
-- gets insufficient_privilege (42501), which the page turns into a 404.
--
-- "Active" means signed in, or refreshed a session, inside the window. A
-- session refreshes roughly hourly while the app is open, so this counts
-- people using the app, not just people logging in. Signing out deletes the
-- session row, so activity before a sign-out is only as recent as
-- last_sign_in_at; a past month's active count cannot be reconstructed, which
-- is why there is no monthly active-users history.
CREATE FUNCTION public.admin_growth_stats()
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
      l.join_token IS NOT NULL
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
