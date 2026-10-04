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
