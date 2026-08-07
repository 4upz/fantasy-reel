/**
 * Notification delivery logging for the `notification_log` table.
 *
 * Generalizes the trade-only helper that used to live in trade-validation.ts
 * so every email path (bids, invitations, announcements, ...) can record
 * delivery outcomes for observability -- see supabase/migrations/20260201_add_notification_log.sql.
 *
 * Never throws: a logging failure must never affect the calling operation.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError } from './logger.ts'
import type { SendEmailResult } from './email.ts'

const log = createLogger('shared/notification-log')

export type NotificationDeliveryStatus = 'sent' | 'failed' | 'skipped'

export interface NotificationDeliveryEntry {
  notificationType: string
  recipientEmail: string
  recipientUserId?: string | null
  tradeOfferId?: string | null
  status: NotificationDeliveryStatus
  messageId?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Log an email delivery outcome via the `log_notification_delivery` RPC.
 * Requires a service-role client -- the notification_log RLS policy only
 * grants INSERT to the service role.
 */
export async function logNotificationDelivery(
  supabase: SupabaseClient,
  entry: NotificationDeliveryEntry
): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_notification_delivery', {
      p_trade_offer_id: entry.tradeOfferId ?? null,
      p_notification_type: entry.notificationType,
      p_recipient_email: entry.recipientEmail,
      p_recipient_user_id: entry.recipientUserId ?? null,
      p_status: entry.status,
      p_message_id: entry.messageId ?? null,
      p_error_message: entry.errorMessage ?? null,
      p_metadata: entry.metadata ?? {},
    })
    if (error) {
      log.error('log_notification_delivery RPC failed', { error: serializeError(error) })
    }
  } catch (error) {
    // Don't let logging failures affect the main flow.
    log.error('Failed to log notification delivery', { error: serializeError(error) })
  }
}

/**
 * Map a SendEmailResult to a delivery status: skipped when no RESEND_API_KEY
 * is configured, failed for any other error, sent otherwise.
 */
export function statusFromEmailResult(result: SendEmailResult): NotificationDeliveryStatus {
  if (result.success) return 'sent'
  if (result.skipped) return 'skipped'
  return 'failed'
}
