-- ============================================================================
-- Discord Channel Integration
--
-- Maps Discord channels to leagues for push notifications via webhooks.
-- Multiple channels per league supported. Webhook URLs are treated as
-- credentials and hidden from RLS SELECT via a safe view.
-- ============================================================================

-- ============================================================================
-- PART 1: Table
-- ============================================================================

CREATE TABLE discord_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  notify_drafts BOOLEAN NOT NULL DEFAULT true,
  notify_bids BOOLEAN NOT NULL DEFAULT true,
  notify_trades BOOLEAN NOT NULL DEFAULT true,
  notify_scores BOOLEAN NOT NULL DEFAULT true,
  bid_alert_role_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_discord_channel UNIQUE (channel_id)
);

COMMENT ON TABLE discord_channels IS 'Maps Discord channels to leagues for push notifications via webhooks. Multiple channels per league supported.';
COMMENT ON COLUMN discord_channels.webhook_url IS 'Discord webhook URL -- treat as credential. Only exposed via service role, hidden from RLS SELECT via safe view.';
COMMENT ON COLUMN discord_channels.enabled IS 'Master toggle for debugging/pausing notifications.';
COMMENT ON COLUMN discord_channels.consecutive_failures IS 'Tracks webhook health. Reset to 0 on success, incremented on failure.';

-- Primary lookup: find all channels for a league (used by webhook utility)
CREATE INDEX idx_discord_channels_league ON discord_channels(league_id);

-- ============================================================================
-- PART 2: Safe View (hides webhook credentials)
-- ============================================================================

CREATE VIEW discord_channels_safe AS
  SELECT id, league_id, guild_id, channel_id, notify_drafts, notify_bids,
         notify_trades, notify_scores, bid_alert_role_id, enabled, created_by,
         created_at, updated_at, last_error_at, consecutive_failures
  FROM discord_channels;

-- ============================================================================
-- PART 3: RLS
-- ============================================================================

ALTER TABLE discord_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "League members can view discord channels"
  ON discord_channels FOR SELECT TO authenticated
  USING (is_league_member(league_id));

CREATE POLICY "League owners can insert discord channels"
  ON discord_channels FOR INSERT TO authenticated
  WITH CHECK (is_league_member(league_id));

CREATE POLICY "League owners can update discord channels"
  ON discord_channels FOR UPDATE TO authenticated
  USING (is_league_owner(league_id));

CREATE POLICY "League owners can delete discord channels"
  ON discord_channels FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ============================================================================
-- PART 4: Helper Function
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_by_discord_id(p_discord_id TEXT)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT user_id FROM auth.identities
  WHERE provider = 'discord' AND provider_id = p_discord_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_user_by_discord_id IS 'Resolve Discord user ID to Supabase user_id via auth.identities.';

-- ============================================================================
-- PART 5: Trigger (reuse existing update_updated_at_column)
-- ============================================================================

CREATE TRIGGER update_discord_channels_updated_at
  BEFORE UPDATE ON discord_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
