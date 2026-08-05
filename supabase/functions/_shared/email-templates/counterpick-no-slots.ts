// supabase/functions/_shared/email-templates/counterpick-no-slots.ts
//
// Sent when a counterpick bid was the strongest bid on a movie but the team had
// already filled every bidding counterpick slot with higher-priority bids. The
// generic "you were outbid" template would be actively misleading here: the team
// was not outbid, it ran out of room.
import { escapeHtml, sanitizeEmailHeader } from '../email.ts'

export interface CounterpickNoSlotsEmailData {
  recipientName: string
  movieTitle: string
  yourBidAmount: number
  slotsUsed: number
  leagueUrl: string
}

export function getCounterpickNoSlotsEmailHtml(data: CounterpickNoSlotsEmailData): string {
  const safeRecipientName = escapeHtml(data.recipientName)
  const safeMovieTitle = escapeHtml(data.movieTitle)
  const slotLabel = data.slotsUsed === 1 ? 'slot' : 'slots'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Counterpick Slots Full</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; color: #b8b0a4; font-size: 24px; font-weight: 600;">
                Counterpick Slots Full
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
                Your bid on <strong style="color: #e8e8e8;">${safeMovieTitle}</strong> was strong enough to win, but
                your higher-priority bids had already filled all ${data.slotsUsed} of your bidding counterpick ${slotLabel}.
                The counterpick went to the next-highest bidder instead, and you were not charged for this bid.
              </p>

              <table role="presentation" style="width: 100%; background-color: #2a2a2a; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="color: #8a8078; font-size: 14px;">Your bid:</td>
                        <td style="text-align: right; color: #e8e8e8; font-size: 16px;">$${data.yourBidAmount}</td>
                      </tr>
                      <tr>
                        <td style="color: #8a8078; font-size: 14px; padding-top: 8px;">Counterpick slots:</td>
                        <td style="text-align: right; color: #c9a227; font-size: 16px; font-weight: 600;">${data.slotsUsed} of ${data.slotsUsed} used</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 14px; line-height: 1.5;">
                Bid priority decides which counterpicks you keep when more of your bids win than you have slots for.
                You can reorder your pending bids any time before processing.
              </p>

              <a href="${data.leagueUrl}?tab=bidding"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Review Your Bids
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

export function getCounterpickNoSlotsEmailText(data: CounterpickNoSlotsEmailData): string {
  const safeRecipientName = sanitizeEmailHeader(data.recipientName)
  const safeMovieTitle = sanitizeEmailHeader(data.movieTitle)
  const slotLabel = data.slotsUsed === 1 ? 'slot' : 'slots'

  return `
Counterpick Slots Full

Hi ${safeRecipientName},

Your bid on ${safeMovieTitle} was strong enough to win, but your higher-priority
bids had already filled all ${data.slotsUsed} of your bidding counterpick ${slotLabel}. The
counterpick went to the next-highest bidder instead, and you were not charged
for this bid.

Your bid: $${data.yourBidAmount}
Counterpick slots: ${data.slotsUsed} of ${data.slotsUsed} used

Bid priority decides which counterpicks you keep when more of your bids win than
you have slots for. You can reorder your pending bids any time before processing.

Review your bids: ${data.leagueUrl}?tab=bidding

---
Fantasy Reel - Movie Fantasy League
  `.trim()
}
