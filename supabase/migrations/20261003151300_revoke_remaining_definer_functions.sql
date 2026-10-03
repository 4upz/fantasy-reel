-- Make the remaining internal SECURITY DEFINER functions service-role only.
--
-- 20260805190000_restore_data_api_default_grants granted EXECUTE on every
-- public function to anon and authenticated. The functions below are SECURITY
-- DEFINER, check nothing about the caller, and were never revoked afterwards,
-- so anyone holding the public anon key could call them through
-- /rest/v1/rpc/*:
--
--   Scoring
--     calculate_movie_score          rescores a movie and stamps
--                                    scores_updated_at, which makes
--                                    update-scores skip it for a day
--     recalculate_teams_for_movie,   rewrite team_scores rows
--     recalculate_team_score_with_counterpicks
--     queue_movies_for_scoring,      the retired pgmq pipeline; process_score_queue
--     queue_movie_for_scoring,       invokes an Edge Function with the
--     process_score_queue,           service key from vault
--     delete_score_queue_message
--
--   Trading
--     get_trade_offer_for_update,    read any row and hold a row lock on it
--     get_team_budget_for_update
--     validate_trade_items           reads any team's roster and budget
--     get_contested_source_ids       no membership check on the league
--     get_team_movie_count,          read any team's roster size, league or
--     get_league_faab_budget,        budget setting
--     get_team_league_id
--
--   Notifications
--     log_notification_delivery      inserts arbitrary notification_log rows
--
-- Every legitimate caller keeps working:
--   * Edge Functions call them with the service role (update-scores,
--     get-trades, _shared/trade-validation.ts, _shared/notification-log.ts).
--   * SQL callers are themselves SECURITY DEFINER and owned by postgres, so a
--     nested call runs as the owner: execute_trade, respond_to_trade,
--     veto_trade, approve_trade, counter_trade, extend_trade_offer,
--     activate_drafted_league, complete_league_season, calculate_movie_score,
--     recalculate_teams_for_movie, and the rescore_season_for_scoring_rule
--     trigger (fired by an owner's direct UPDATE on leagues).
--   * Nothing in the web app or Discord bot calls them.
--
-- The blanket grant itself is left alone; the RLS helpers (is_league_member,
-- is_team_owner, ...) and the draft RPCs, which check auth.uid(), still need it.

REVOKE EXECUTE ON FUNCTION calculate_movie_score(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_movie_score(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION recalculate_teams_for_movie(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recalculate_teams_for_movie(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION recalculate_team_score_with_counterpicks(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recalculate_team_score_with_counterpicks(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION queue_movies_for_scoring() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION queue_movies_for_scoring() TO service_role;

REVOKE EXECUTE ON FUNCTION queue_movie_for_scoring(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION queue_movie_for_scoring(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION process_score_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_score_queue() TO service_role;

REVOKE EXECUTE ON FUNCTION delete_score_queue_message(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_score_queue_message(BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION get_trade_offer_for_update(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_trade_offer_for_update(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION get_team_budget_for_update(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_budget_for_update(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION validate_trade_items(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validate_trade_items(UUID, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION get_contested_source_ids(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_contested_source_ids(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION get_team_movie_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_movie_count(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION get_league_faab_budget(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_league_faab_budget(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION get_team_league_id(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_league_id(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION log_notification_delivery(UUID, TEXT, TEXT, UUID, notification_delivery_status, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION log_notification_delivery(UUID, TEXT, TEXT, UUID, notification_delivery_status, TEXT, TEXT, JSONB)
  TO service_role;
