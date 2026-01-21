// supabase/functions/_shared/email-templates/bid-lost.ts
export interface BidLostEmailData {
  recipientName: string
  movieTitle: string
  yourBidAmount: number
  winningAmount: number
  leagueUrl: string
}

export function getBidLostEmailHtml(data: BidLostEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bid Unsuccessful</title>
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
                Bid Unsuccessful
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #e8e8e8; font-size: 16px; line-height: 1.5;">
                Hi ${data.recipientName},
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                Unfortunately, your bid on <strong style="color: #e8e8e8;">${data.movieTitle}</strong> was unsuccessful.
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
                        <td style="color: #8a8078; font-size: 14px; padding-top: 8px;">Winning bid:</td>
                        <td style="text-align: right; color: #c9a227; font-size: 16px; font-weight: 600;">$${data.winningAmount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 14px; line-height: 1.5;">
                Better luck next time! Check out other movies available for pickup.
              </p>

              <a href="${data.leagueUrl}?tab=bidding"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Browse Movies
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

export function getBidLostEmailText(data: BidLostEmailData): string {
  return `
Bid Unsuccessful

Hi ${data.recipientName},

Unfortunately, your bid on ${data.movieTitle} was unsuccessful.

Your bid: $${data.yourBidAmount}
Winning bid: $${data.winningAmount}

Better luck next time! Check out other movies available for pickup.

Browse movies: ${data.leagueUrl}?tab=bidding

---
Fantasy Reel - Movie Fantasy League
  `.trim()
}
