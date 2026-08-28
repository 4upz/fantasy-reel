// supabase/functions/_shared/email-templates/season-final-standings.ts
//
// The season wrap-up email: who won, where everyone finished, and a link to
// the standings that will not change again.
//
// The recipient's own row is highlighted rather than pulled out into a "you
// finished Nth" line -- the whole table is the point of this email, and
// finding yourself in it is the first thing anyone does.
import { escapeHtml, sanitizeEmailHeader } from '../email.ts'

export interface SeasonFinalStandingsRow {
  rank: number
  teamName: string
  points: number
  /** True for the recipient's own team, which gets highlighted in the table. */
  isRecipient: boolean
}

export interface SeasonFinalStandingsEmailData {
  recipientName: string
  leagueName: string
  seasonYear: number
  /** Base league URL, e.g. https://…/league/<id>. `/standings` is appended. */
  leagueUrl: string
  /** Every team tied at rank 1. More than one means co-champions. */
  championNames: string[]
  standings: SeasonFinalStandingsRow[]
}

/** "A", "A and B", "A, B and C" -- co-champions are named, not counted. */
function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The one sentence that names the champion.
 *
 * Exported because the in-app `season_completed` notification says the same
 * thing, and the two announcing the same result in different words would be a
 * small but real inconsistency. Callers escape or sanitize the names first --
 * this only joins them.
 */
export function championLine(championNames: string[]): string {
  if (championNames.length === 0) return 'The season is over.'
  const verb = championNames.length > 1 ? 'share the title' : 'takes the title'
  return `${joinNames(championNames)} ${verb}.`
}

const MEDALS = ['🥇', '🥈', '🥉']

/** The medal for a rank, or the number itself from 4th down. */
function rankLabel(rank: number): string {
  return MEDALS[rank - 1] ?? `${rank}`
}

export function getSeasonFinalStandingsEmailHtml(data: SeasonFinalStandingsEmailData): string {
  const safeRecipientName = escapeHtml(data.recipientName)
  const safeLeagueName = escapeHtml(data.leagueName)
  // The names are escaped, not the joined sentence: championLine only adds
  // literal punctuation around them, and escaping the result again would turn
  // an already-escaped `&amp;` into `&amp;amp;` on screen.
  const safeChampionLine = championLine(data.championNames.map(escapeHtml))

  const rows = data.standings
    .map((row) => {
      const nameColor = row.isRecipient ? '#c9a227' : '#e8e8e8'
      const weight = row.isRecipient ? '600' : '400'
      return `
            <tr>
              <td style="padding: 10px 8px; border-bottom: 1px solid #2e2e2e; color: #b8b0a4; font-size: 15px; width: 44px;">${rankLabel(row.rank)}</td>
              <td style="padding: 10px 8px; border-bottom: 1px solid #2e2e2e; color: ${nameColor}; font-weight: ${weight}; font-size: 15px;">${escapeHtml(row.teamName)}</td>
              <td style="padding: 10px 8px; border-bottom: 1px solid #2e2e2e; color: ${nameColor}; font-weight: ${weight}; font-size: 15px; text-align: right; white-space: nowrap;">${row.points.toFixed(1)} pts</td>
            </tr>`
    })
    .join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Final Standings</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <p style="margin: 0 0 8px; color: #8a8078; font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">
                ${data.seasonYear} Season
              </p>
              <h1 style="margin: 0; color: #c9a227; font-size: 24px; font-weight: 600;">
                🏆 Final Standings
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #e8e8e8; font-size: 16px; line-height: 1.5;">
                ${safeRecipientName}, that's a wrap on <strong style="color: #e8e8e8;">${safeLeagueName}</strong>.
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                ${safeChampionLine}
              </p>

              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 28px;">
                ${rows}
              </table>

              <a href="${data.leagueUrl}/standings"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                View Final Standings
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

export function getSeasonFinalStandingsEmailText(data: SeasonFinalStandingsEmailData): string {
  const safeRecipientName = sanitizeEmailHeader(data.recipientName)
  const safeLeagueName = sanitizeEmailHeader(data.leagueName)
  const safeChampionLine = championLine(data.championNames.map(sanitizeEmailHeader))

  const rows = data.standings
    .map((row) => {
      const marker = row.isRecipient ? ' (you)' : ''
      return `${row.rank}. ${sanitizeEmailHeader(row.teamName)}${marker} - ${row.points.toFixed(1)} pts`
    })
    .join('\n')

  return `
${data.seasonYear} Season - Final Standings

${safeRecipientName}, that's a wrap on ${safeLeagueName}.

${safeChampionLine}

${rows}

View final standings: ${data.leagueUrl}/standings

---
Fantasy Reel - Movie Fantasy League
  `.trim()
}
