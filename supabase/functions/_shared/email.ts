/**
 * Email utilities for sending transactional emails via Resend
 */

import { isValidEmail } from './utils.ts'

// Types
export interface InvitationEmailData {
  recipientEmail: string
  inviterName: string
  leagueName: string
  inviteUrl: string
  expiresAt: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Format expiration date for display in email
 */
function formatExpirationDate(expiresAt: string): string {
  const date = new Date(expiresAt)
  if (isNaN(date.getTime())) {
    return 'soon'
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Escape HTML special characters to prevent XSS in email templates
 */
function escapeHtml(text: string): string {
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
function sanitizeEmailHeader(text: string): string {
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
 * Send an invitation email via Resend API
 * Returns success status - never throws to avoid blocking invitation creation
 */
export async function sendInvitationEmail(data: InvitationEmailData): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fantasy Reel <noreply@fantasyreels.com>'

  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured - skipping email send')
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  // Validate recipient email
  if (!isValidEmail(data.recipientEmail)) {
    console.warn('Invalid recipient email format')
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
    const response = await fetch('https://api.resend.com/emails', {
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
    })

    if (!response.ok) {
      // Log only status code, not full response body (may contain sensitive info)
      console.error('Resend API error', { status: response.status })
      return { success: false, error: 'Email delivery failed' }
    }

    const result = await response.json()
    console.log('Email sent successfully:', result.id)
    return { success: true, messageId: result.id }

  } catch (error) {
    // Log error type only, not full details
    console.error('Email send error', {
      type: error instanceof Error ? error.constructor.name : 'Unknown'
    })
    return { success: false, error: 'Email delivery unavailable' }
  }
}
