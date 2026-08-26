/**
 * Email utilities for sending transactional emails via Resend
 */

import { isValidEmail } from './utils.ts'
import { fetchWithTimeout } from './http.ts'
import { createLogger } from './logger.ts'

const log = createLogger('shared/email')

// Types
export interface InvitationEmailData {
  recipientEmail: string
  inviterName: string
  leagueName: string
  inviteUrl: string
  expiresAt: string
}

export interface TradeEmailData {
  recipientEmail: string
  recipientTeamName: string
  otherTeamName: string
  leagueName: string
  leagueUrl: string
  offeredItems: string // Pre-formatted list (e.g., "Movie A, Movie B, $10 budget")
  requestedItems: string // Pre-formatted list
  message?: string
  vetoReason?: string
  reviewEndsAt?: string
  /** When an unanswered offer lapses. Absent when the offer has no clock. */
  expiresAt?: string
  /** Why an expired offer expired, already phrased for a reader. */
  expiredReason?: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
  /** True when the send was intentionally skipped (no RESEND_API_KEY configured),
   *  as opposed to an actual delivery failure. Lets callers log 'skipped' vs
   *  'failed' to notification_log without string-matching `error`. */
  skipped?: boolean
}

/**
 * Format expiration date for display in email
 */
/**
 * A date for an email, in UTC and labelled as such.
 *
 * `withTime` because the two callers want different resolution: a multi-day
 * review window reads fine as a date, while "expires at 4pm" does not. The
 * timezone is spelled out either way, since this renders in whatever locale
 * the Edge Function runs in, which is not the reader's.
 */
function formatExpirationDate(expiresAt: string, options?: { withTime?: boolean }): string {
  const date = new Date(expiresAt)
  if (isNaN(date.getTime())) {
    return 'soon'
  }

  const formatted = date.toLocaleDateString('en-US', {
    weekday: 'long',
    ...(options?.withTime ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
    ...(options?.withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'UTC',
  })

  // The zone label only earns its place next to a time. The two date-only
  // callers (invitation expiry) rendered without one before this, and their
  // copy should not change.
  return options?.withTime ? `${formatted} UTC` : formatted
}

/**
 * Escape HTML special characters to prevent XSS in email templates
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char])
}

/**
 * Sanitize text for use in email headers to prevent header injection attacks.
 * Removes newlines and control characters that could be used to inject headers.
 */
export function sanitizeEmailHeader(text: string): string {
  return text.replace(/[\r\n\t\x00-\x1f]/g, ' ').trim()
}

/**
 * Build HTML email template for league invitation
 * Uses Cinematic Dark theme colors matching the app design system
 */
export function buildInvitationEmailHtml(data: InvitationEmailData): string {
  const { inviterName, leagueName, inviteUrl, expiresAt } = data
  const expirationDate = formatExpirationDate(expiresAt)

  // Escape user-provided content
  const safeInviterName = escapeHtml(inviterName)
  const safeLeagueName = escapeHtml(leagueName)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fantasy Reel Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #0f0f0f;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #c9a227; letter-spacing: 1px;">
                FANTASY REEL
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 28px; font-weight: 600; color: #e8e8e8; text-align: center;">
                You're Invited!
              </h2>

              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #b8b0a4; text-align: center;">
                <strong style="color: #e8e8e8;">${safeInviterName}</strong> has invited you to join their fantasy movie league:
              </p>

              <p style="margin: 0 0 32px; font-size: 22px; font-weight: 600; color: #c9a227; text-align: center;">
                ${safeLeagueName}
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: #c9a227; color: #0f0f0f; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      Join League
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 32px 0 0; font-size: 14px; color: #8a8078; text-align: center;">
                This invitation expires on <strong style="color: #b8b0a4;">${expirationDate}</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #161616; border-top: 1px solid #2e2e2e; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; font-size: 12px; color: #8a8078; text-align: center;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Build plain text email for league invitation (fallback for email clients)
 */
export function buildInvitationEmailText(data: InvitationEmailData): string {
  const { inviterName, leagueName, inviteUrl, expiresAt } = data
  const expirationDate = formatExpirationDate(expiresAt)

  // Sanitize user content to prevent newline injection in plain text
  const safeName = sanitizeEmailHeader(inviterName)
  const safeLeague = sanitizeEmailHeader(leagueName)

  return `FANTASY REEL

You're Invited!

${safeName} has invited you to join their fantasy movie league: ${safeLeague}

Join the league here: ${inviteUrl}

This invitation expires on ${expirationDate}.

If you didn't expect this invitation, you can safely ignore this email.`
}

/**
 * Generic email sending parameters
 */
export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Send an email via Resend API
 * Returns success status - never throws to avoid blocking the calling operation
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fantasy Reel <noreply@fantasyreel.com>'

  if (!apiKey) {
    log.warn('RESEND_API_KEY not configured - skipping email send')
    return { success: false, error: 'RESEND_API_KEY not configured', skipped: true }
  }

  // Validate recipient email
  if (!isValidEmail(params.to)) {
    log.warn('Invalid recipient email format')
    return { success: false, error: 'Invalid recipient email' }
  }

  // Sanitize email headers to prevent injection attacks
  const sanitizedFrom = sanitizeEmailHeader(fromEmail)
  const sanitizedSubject = sanitizeEmailHeader(params.subject)

  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sanitizedFrom,
        to: [params.to],
        subject: sanitizedSubject,
        html: params.html,
        text: params.text,
      }),
    }, 10_000)

    if (!response.ok) {
      log.error('Resend API error', { status: response.status })
      return { success: false, error: 'Email delivery failed' }
    }

    const result = await response.json()
    log.info('Email sent successfully', { message_id: result.id })
    return { success: true, messageId: result.id }

  } catch (error) {
    // Log error type only, not full details -- the message may echo recipient PII.
    log.error('Email send error', {
      error_type: error instanceof Error ? error.constructor.name : 'Unknown'
    })
    return { success: false, error: 'Email delivery unavailable' }
  }
}

/**
 * Send an invitation email via Resend API
 * Returns success status - never throws to avoid blocking invitation creation
 */
export async function sendInvitationEmail(data: InvitationEmailData): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fantasy Reel <noreply@fantasyreel.com>'

  if (!apiKey) {
    log.warn('RESEND_API_KEY not configured - skipping email send')
    return { success: false, error: 'RESEND_API_KEY not configured', skipped: true }
  }

  // Validate recipient email
  if (!isValidEmail(data.recipientEmail)) {
    log.warn('Invalid recipient email format')
    return { success: false, error: 'Invalid recipient email' }
  }

  // Sanitize email headers to prevent injection attacks
  const sanitizedFrom = sanitizeEmailHeader(fromEmail)
  const sanitizedSubject = sanitizeEmailHeader(
    `You've been invited to join ${data.leagueName} on Fantasy Reel`
  )

  const htmlContent = buildInvitationEmailHtml(data)
  const textContent = buildInvitationEmailText(data)

  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sanitizedFrom,
        to: [data.recipientEmail],
        subject: sanitizedSubject,
        html: htmlContent,
        text: textContent,
      }),
    }, 10_000)

    if (!response.ok) {
      // Log only status code, not full response body (may contain sensitive info)
      log.error('Resend API error', { status: response.status })
      return { success: false, error: 'Email delivery failed' }
    }

    const result = await response.json()
    log.info('Email sent successfully', { message_id: result.id })
    return { success: true, messageId: result.id }

  } catch (error) {
    // Log error type only, not full details
    log.error('Email send error', {
      error_type: error instanceof Error ? error.constructor.name : 'Unknown'
    })
    return { success: false, error: 'Email delivery unavailable' }
  }
}

// ============================================================================
// Trade Email Templates
// ============================================================================

export type TradeEmailType =
  | 'proposed'
  | 'countered'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'vetoed'
  | 'expiring_soon'
  | 'expired'

interface TradeEmailConfig {
  subject: string
  heading: string
  subheading: string
  ctaText: string
  showItems: boolean
  accentColor: string
}

function getTradeEmailConfig(type: TradeEmailType, data: TradeEmailData): TradeEmailConfig {
  const configs: Record<TradeEmailType, TradeEmailConfig> = {
    proposed: {
      subject: `New trade offer from ${data.otherTeamName} in ${data.leagueName}`,
      heading: 'New Trade Offer!',
      subheading: `<strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> has proposed a trade with you in <strong style="color: #c9a227;">${escapeHtml(data.leagueName)}</strong>`,
      ctaText: 'Review Trade',
      showItems: true,
      accentColor: '#c9a227', // gold
    },
    countered: {
      subject: `${data.otherTeamName} countered your trade in ${data.leagueName}`,
      heading: 'Trade Countered',
      subheading: `<strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> has countered your trade offer with new terms`,
      ctaText: 'Review Counter',
      showItems: true,
      accentColor: '#d4b23a', // gold-hover
    },
    accepted: {
      subject: `Trade accepted! Review period started in ${data.leagueName}`,
      heading: 'Trade Accepted!',
      subheading: `<strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> accepted your trade. The trade is now in the review period.`,
      ctaText: 'View Trade',
      showItems: true,
      accentColor: '#4ade80', // green
    },
    rejected: {
      subject: `Trade declined in ${data.leagueName}`,
      heading: 'Trade Declined',
      subheading: `<strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> has declined your trade offer`,
      ctaText: 'View Details',
      showItems: true,
      accentColor: '#a8505c', // crimson
    },
    completed: {
      subject: `Trade completed in ${data.leagueName}!`,
      heading: 'Trade Complete!',
      subheading: `Your trade with <strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> has been processed. Assets have been transferred.`,
      ctaText: 'View Roster',
      showItems: true,
      accentColor: '#4ade80', // green
    },
    expiring_soon: {
      subject: `Trade offer with ${data.otherTeamName} expires soon in ${data.leagueName}`,
      heading: 'Trade Offer Expiring Soon',
      // Deliberately neutral about which side is reading. Unlike every other
      // trade email, this one goes to BOTH parties in the same shape, and
      // sendTradeEmailNotifications gives the template no way to tell them
      // apart. The per-party wording ("you have to answer" vs "they haven't")
      // lives in the in-app notification, which does know.
      subheading: `Your trade offer with <strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> is still unanswered, and its clock is running out`,
      ctaText: 'Review Trade',
      showItems: true,
      accentColor: '#d4b23a', // gold-hover -- attention, not alarm; nothing is wrong yet
    },
    expired: {
      subject: `Trade offer expired in ${data.leagueName}`,
      heading: 'Trade Offer Expired',
      subheading: `Your trade with <strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong> expired before it was answered`,
      ctaText: 'Propose Another',
      showItems: true,
      accentColor: '#8a8078', // muted -- nothing went wrong, the clock just ran out
    },
    vetoed: {
      subject: `Trade vetoed by commissioner in ${data.leagueName}`,
      heading: 'Trade Vetoed',
      subheading: `The commissioner has vetoed your trade with <strong style="color: #e8e8e8;">${escapeHtml(data.otherTeamName)}</strong>`,
      ctaText: 'View Details',
      showItems: false,
      accentColor: '#a8505c', // crimson
    },
  }
  return configs[type]
}

/**
 * Column headings for the two sides of a deal: [initiator's side, recipient's side].
 *
 * A live offer is described from the reader's side ("They Offer"), which works
 * only because those emails go to the one party being asked to answer. The
 * expiring-soon nudge goes to BOTH parties, so it describes the offer instead
 * of the reader: "You Gave" would be false (nothing has moved) and "They Offer"
 * would be backwards for the proposer, who is looking at their own movies.
 */
function tradeItemHeadings(type: TradeEmailType): [string, string] {
  if (type === 'proposed' || type === 'countered') return ['They Offer', 'They Request']
  if (type === 'expiring_soon') return ['Offered', 'Requested']
  return ['You Gave', 'You Received']
}

/**
 * Build HTML email template for trade notifications
 */
export function buildTradeEmailHtml(type: TradeEmailType, data: TradeEmailData): string {
  const config = getTradeEmailConfig(type, data)
  const [offeredHeading, requestedHeading] = tradeItemHeadings(type)
  const safeMessage = data.message ? escapeHtml(data.message) : null
  const safeVetoReason = data.vetoReason ? escapeHtml(data.vetoReason) : null

  const itemsSection = config.showItems ? `
              <!-- Trade Items -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="width: 48%; vertical-align: top; padding: 16px; background-color: #262626; border-radius: 8px;">
                    <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #8a8078; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${offeredHeading}
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #e8e8e8; line-height: 1.5;">
                      ${escapeHtml(data.offeredItems) || '<em style="color: #8a8078;">Nothing</em>'}
                    </p>
                  </td>
                  <td style="width: 4%; text-align: center; vertical-align: middle;">
                    <span style="color: #c9a227; font-size: 20px;">⇄</span>
                  </td>
                  <td style="width: 48%; vertical-align: top; padding: 16px; background-color: #262626; border-radius: 8px;">
                    <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #8a8078; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${requestedHeading}
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #e8e8e8; line-height: 1.5;">
                      ${escapeHtml(data.requestedItems) || '<em style="color: #8a8078;">Nothing</em>'}
                    </p>
                  </td>
                </tr>
              </table>` : ''

  const messageSection = safeMessage ? `
              <div style="margin-bottom: 24px; padding: 16px; background-color: #262626; border-left: 3px solid ${config.accentColor}; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #8a8078;">Message:</p>
                <p style="margin: 0; font-size: 14px; color: #b8b0a4; font-style: italic;">"${safeMessage}"</p>
              </div>` : ''

  const vetoSection = safeVetoReason ? `
              <div style="margin-bottom: 24px; padding: 16px; background-color: #2a1f1f; border-left: 3px solid #a8505c; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #a8505c;">Veto Reason:</p>
                <p style="margin: 0; font-size: 14px; color: #b8b0a4;">${safeVetoReason}</p>
              </div>` : ''

  const reviewSection = type === 'accepted' && data.reviewEndsAt ? `
              <p style="margin: 0 0 24px; font-size: 14px; color: #b8b0a4; text-align: center;">
                Review period ends: <strong style="color: #e8e8e8;">${formatExpirationDate(data.reviewEndsAt)}</strong>
              </p>` : ''

  // An offer with a clock says so up front -- the whole point of the feature is
  // that the recipient knows how long they have without asking in Discord. On
  // the expiring-soon nudge this line IS the message, so it renders there too.
  const expirySection =
    (type === 'proposed' || type === 'countered' || type === 'expiring_soon') && data.expiresAt ? `
              <p style="margin: 0 0 24px; font-size: 14px; color: #b8b0a4; text-align: center;">
                This offer expires: <strong style="color: #e8e8e8;">${formatExpirationDate(data.expiresAt, { withTime: true })}</strong>
              </p>` : ''

  const expiredSection = type === 'expired' && data.expiredReason ? `
              <p style="margin: 0 0 24px; font-size: 14px; color: #b8b0a4; text-align: center;">
                ${escapeHtml(data.expiredReason)}
              </p>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fantasy Reel Trade</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #0f0f0f;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #c9a227; letter-spacing: 1px;">
                FANTASY REEL
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 28px; font-weight: 600; color: ${config.accentColor}; text-align: center;">
                ${config.heading}
              </h2>

              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #b8b0a4; text-align: center;">
                ${config.subheading}
              </p>

              ${itemsSection}
              ${messageSection}
              ${vetoSection}
              ${reviewSection}
              ${expirySection}
              ${expiredSection}

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${data.leagueUrl}/trading" style="display: inline-block; padding: 14px 32px; background-color: ${config.accentColor}; color: #0f0f0f; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      ${config.ctaText}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #161616; border-top: 1px solid #2e2e2e; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; font-size: 12px; color: #8a8078; text-align: center;">
                This notification was sent from Fantasy Reel for league "${escapeHtml(data.leagueName)}".
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Build plain text email for trade notifications
 */
export function buildTradeEmailText(type: TradeEmailType, data: TradeEmailData): string {
  const config = getTradeEmailConfig(type, data)
  const [offeredHeading, requestedHeading] = tradeItemHeadings(type)
  const safeName = sanitizeEmailHeader(data.otherTeamName)
  const safeLeague = sanitizeEmailHeader(data.leagueName)

  let text = `FANTASY REEL

${config.heading}

${safeName} - ${safeLeague}

`

  if (config.showItems) {
    text += `${offeredHeading}:
${data.offeredItems || 'Nothing'}

${requestedHeading}:
${data.requestedItems || 'Nothing'}

`
  }

  if (data.message) {
    text += `Message: "${sanitizeEmailHeader(data.message)}"

`
  }

  if (data.vetoReason) {
    text += `Veto Reason: ${sanitizeEmailHeader(data.vetoReason)}

`
  }

  if (type === 'accepted' && data.reviewEndsAt) {
    text += `Review period ends: ${formatExpirationDate(data.reviewEndsAt)}

`
  }

  if (
    (type === 'proposed' || type === 'countered' || type === 'expiring_soon') &&
    data.expiresAt
  ) {
    text += `This offer expires: ${formatExpirationDate(data.expiresAt, { withTime: true })}

`
  }

  if (type === 'expired' && data.expiredReason) {
    text += `${sanitizeEmailHeader(data.expiredReason)}

`
  }

  text += `${config.ctaText}: ${data.leagueUrl}/trading

This notification was sent from Fantasy Reel for league "${safeLeague}".`

  return text
}

/**
 * Send a trade notification email
 */
export async function sendTradeEmail(
  type: TradeEmailType,
  data: TradeEmailData
): Promise<SendEmailResult> {
  const config = getTradeEmailConfig(type, data)

  return sendEmail({
    to: data.recipientEmail,
    subject: config.subject,
    html: buildTradeEmailHtml(type, data),
    text: buildTradeEmailText(type, data),
  })
}

/**
 * Format trade items for email display
 * @param movies Array of movie titles
 * @param budget Fantasy budget amount (0 if none)
 * @returns Formatted string like "Movie A, Movie B, $10 budget"
 */
export function formatTradeItemsForEmail(movies: string[], budget: number): string {
  const parts: string[] = [...movies]
  if (budget > 0) {
    parts.push(`$${budget} budget`)
  }
  return parts.length > 0 ? parts.join(', ') : 'Nothing'
}
