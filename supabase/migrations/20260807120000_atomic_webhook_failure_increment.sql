-- ============================================================================
-- Atomic Discord Webhook Failure Increment
--
-- discord.ts's trackFailure() previously did a read-then-write increment of
-- discord_channels.consecutive_failures: SELECT the current count, add one
-- in JS, UPDATE. Concurrent failures for the same channel (e.g. two league
-- notifications landing on the same broken webhook around the same time)
-- can race on that read, under-counting the true failure streak and
-- delaying (or skipping) the consecutive_failures === 3 ops alert.
--
-- This function does the increment in a single UPDATE ... RETURNING, so the
-- read and write happen atomically under the row lock Postgres already takes
-- for the UPDATE -- no race window. SECURITY DEFINER because the Edge
-- Function calls it via the service-role client but RLS on discord_channels
-- otherwise only allows league members/owners to touch their own league's
-- rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_discord_webhook_failure(p_channel_id uuid)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE discord_channels
  SET consecutive_failures = consecutive_failures + 1,
      last_error_at = now()
  WHERE id = p_channel_id
  RETURNING consecutive_failures;
$$;

COMMENT ON FUNCTION increment_discord_webhook_failure IS 'Atomically increments discord_channels.consecutive_failures and stamps last_error_at, returning the new count. Avoids the read-then-write race of a select+update from the caller.';

-- Restrict to service_role only, matching the pattern established for the
-- other Discord SECURITY DEFINER functions (get_user_by_discord_id,
-- get_discord_ids_by_user_ids in 20260804203436_add_discord_id_reverse_lookup.sql,
-- re-asserted in 20260805190000_restore_data_api_default_grants.sql). Without
-- this, the ALTER DEFAULT PRIVILEGES grant added in that migration would let
-- any authenticated client invoke this mutation directly via PostgREST RPC.
REVOKE EXECUTE ON FUNCTION increment_discord_webhook_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_discord_webhook_failure(uuid) TO service_role;
