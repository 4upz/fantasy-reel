-- Bids are written only by Edge Functions, never by clients.
--
-- pickup_bids and counterpick_bids carried INSERT and UPDATE policies that
-- checked nothing but is_team_owner(team_id). With the blanket table grant in
-- 20260805190000_restore_data_api_default_grants, a team owner could write
-- their own bid rows straight through PostgREST and skip every rule in
-- place-bid / place-counterpick-bid: raise an outbid bid with no counter
-- window, backdate created_at to win ties, revive a lost bid, or ignore the
-- cutoff, min/max and scored-movie checks.
--
-- Every legitimate writer already uses the service role (which bypasses RLS
-- and keeps its grants): place-bid, place-counterpick-bid, cancel-bid,
-- cancel-counterpick-bid, set-bid-priorities, set-counterpick-bid-priorities
-- and process-bids. The SQL writers (complete_league_season,
-- settle_counterpicks_for_trade) run as SECURITY DEFINER. The web app and the
-- Discord bot only read these tables, and Realtime needs SELECT alone, so
-- reads are untouched. This mirrors what
-- 20260911215230_atomic_draft_picks_and_phases did for draft_picks.

REVOKE INSERT, UPDATE, DELETE ON public.pickup_bids, public.counterpick_bids
  FROM PUBLIC, anon, authenticated;

-- The client write policies are now unreachable; drop them so the policy list
-- says what is actually allowed.
DROP POLICY IF EXISTS "Users can insert bids for their team" ON public.pickup_bids;
DROP POLICY IF EXISTS "Users can update their own bids" ON public.pickup_bids;
DROP POLICY IF EXISTS "Users can insert counterpick bids for their team" ON public.counterpick_bids;
DROP POLICY IF EXISTS "Users can update counterpick bids for their team" ON public.counterpick_bids;
