-- ============================================================================
-- Notification Log for Email Delivery Tracking
--
-- Tracks email notification delivery status to provide visibility into
-- failed notifications. Addresses tech debt item BE#7 - silent email failures.
-- ============================================================================

-- ============================================================================
-- PART 1: Notification Status Enum
-- ============================================================================

CREATE TYPE notification_delivery_status AS ENUM (
  'sent',       -- Successfully delivered to email provider
  'failed',     -- Failed to deliver
  'skipped'     -- Intentionally skipped (e.g., no API key configured)
);

-- ============================================================================
-- PART 2: Notification Log Table
-- ============================================================================

CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to trade (optional, allows for other notification types later)
  trade_offer_id UUID REFERENCES trade_offers(id) ON DELETE SET NULL,

  -- Notification details
  notification_type TEXT NOT NULL,  -- e.g., 'trade_proposed', 'trade_accepted'
  recipient_email TEXT NOT NULL,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Delivery tracking
  status notification_delivery_status NOT NULL,
  message_id TEXT,                  -- External provider's message ID (e.g., Resend)
  error_message TEXT,               -- Error details if failed

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,  -- Additional context (league_id, team names, etc.)

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PART 3: Indexes
-- ============================================================================

-- Find notifications for a specific trade
CREATE INDEX idx_notification_log_trade ON notification_log(trade_offer_id)
  WHERE trade_offer_id IS NOT NULL;

-- Find failed notifications (for monitoring/retry)
CREATE INDEX idx_notification_log_failed ON notification_log(status, created_at)
  WHERE status = 'failed';

-- Find notifications for a user
CREATE INDEX idx_notification_log_user ON notification_log(recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

-- Recent notifications (for dashboard/admin views)
CREATE INDEX idx_notification_log_recent ON notification_log(created_at DESC);

-- ============================================================================
-- PART 4: RLS Policies
-- ============================================================================

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own notification history
CREATE POLICY "Users can view their own notifications" ON notification_log
  FOR SELECT TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()));

-- Trade participants can view notifications for their trades
CREATE POLICY "Trade participants can view trade notifications" ON notification_log
  FOR SELECT TO authenticated
  USING (
    trade_offer_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM trade_offers t
      WHERE t.id = notification_log.trade_offer_id
        AND (is_team_owner(t.initiator_team_id) OR is_team_owner(t.recipient_team_id))
    )
  );

-- League owners can view all trade notifications in their leagues
CREATE POLICY "League owners can view league notifications" ON notification_log
  FOR SELECT TO authenticated
  USING (
    trade_offer_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM trade_offers t
      WHERE t.id = notification_log.trade_offer_id
        AND is_league_owner(t.league_id)
    )
  );

-- Service role can insert (email functions run as service role)
CREATE POLICY "Service role can manage notification log" ON notification_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 5: Helper Function for Logging
-- ============================================================================

-- Function to log notification delivery (called from Edge Functions)
CREATE OR REPLACE FUNCTION log_notification_delivery(
  p_trade_offer_id UUID,
  p_notification_type TEXT,
  p_recipient_email TEXT,
  p_recipient_user_id UUID,
  p_status notification_delivery_status,
  p_message_id TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO notification_log (
    trade_offer_id,
    notification_type,
    recipient_email,
    recipient_user_id,
    status,
    message_id,
    error_message,
    metadata
  ) VALUES (
    p_trade_offer_id,
    p_notification_type,
    p_recipient_email,
    p_recipient_user_id,
    p_status,
    p_message_id,
    p_error_message,
    p_metadata
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- ============================================================================
-- PART 6: View for Failed Notifications (Admin Dashboard)
-- ============================================================================

CREATE VIEW failed_notifications AS
SELECT
  nl.id,
  nl.trade_offer_id,
  nl.notification_type,
  nl.recipient_email,
  nl.error_message,
  nl.created_at,
  nl.metadata,
  t.league_id,
  l.name as league_name
FROM notification_log nl
LEFT JOIN trade_offers t ON t.id = nl.trade_offer_id
LEFT JOIN leagues l ON l.id = t.league_id
WHERE nl.status = 'failed'
ORDER BY nl.created_at DESC;

-- ============================================================================
-- PART 7: Comments
-- ============================================================================

COMMENT ON TABLE notification_log IS 'Tracks email notification delivery status for observability';
COMMENT ON COLUMN notification_log.trade_offer_id IS 'Reference to trade (NULL for non-trade notifications)';
COMMENT ON COLUMN notification_log.notification_type IS 'Type of notification (e.g., trade_proposed, trade_accepted)';
COMMENT ON COLUMN notification_log.message_id IS 'External message ID from email provider (e.g., Resend)';
COMMENT ON COLUMN notification_log.metadata IS 'Additional context like league_id, team names, etc.';
COMMENT ON VIEW failed_notifications IS 'Admin view of all failed email notifications';
