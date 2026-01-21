// supabase/functions/_shared/email-templates/outbid.ts
import { escapeHtml, sanitizeEmailHeader } from '../email.ts'

export interface OutbidEmailData {
  recipientName: string
  movieTitle: string
  yourBidAmount: number
  newBidAmount: number
  counterDeadline: string
  leagueUrl: string
}

export function getOutbidEmailHtml(data: OutbidEmailData): string {
  // Escape user-provided content to prevent XSS
  const safeRecipientName = escapeHtml(data.recipientName)
  const safeMovieTitle = escapeHtml(data.movieTitle)

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've Been Outbid</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; color: #c9a227; font-size: 24px; font-weight: 600;">
                You've Been Outbid!
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #e8e8e8; font-size: 16px; line-height: 1.5;">
                Hi ${safeRecipientName},
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                Someone has outbid you on <strong style="color: #e8e8e8;">${safeMovieTitle}</strong>.
              </p>

              <table role="presentation" style="width: 100%; background-color: #2a2a2a; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="color: #8a8078; font-size: 14px;">Your bid:</td>
                        <td style="text-align: right; color: #e8e8e8; font-size: 16px; font-weight: 600;">$${data.yourBidAmount}</td>
                      </tr>
                      <tr>
                        <td style="color: #8a8078; font-size: 14px; padding-top: 8px;">New highest bid:</td>
                        <td style="text-align: right; color: #c9a227; font-size: 16px; font-weight: 600;">$${data.newBidAmount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 14px; line-height: 1.5;">
                You have until <strong style="color: #e8e8e8;">${data.counterDeadline}</strong> to place a counter-bid.
              </p>

              <a href="${data.leagueUrl}?tab=bidding"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Counter Bid Now
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #2e2e2e; text-align: center;">
              <p style="margin: 0; color: #8a8078; font-size: 12px;">
                Fantasy Reel - Movie Fantasy League
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export function getOutbidEmailText(data: OutbidEmailData): string {
  // Sanitize user-provided content to prevent newline injection
  const safeRecipientName = sanitizeEmailHeader(data.recipientName)
  const safeMovieTitle = sanitizeEmailHeader(data.movieTitle)

  return `
You've Been Outbid!

Hi ${safeRecipientName},

Someone has outbid you on ${safeMovieTitle}.

Your bid: $${data.yourBidAmount}
New highest bid: $${data.newBidAmount}

You have until ${data.counterDeadline} to place a counter-bid.

Counter bid now: ${data.leagueUrl}?tab=bidding

---
Fantasy Reel - Movie Fantasy League
  `.trim()
}
