/**
 * Lightweight Discord alerting for internal ops (failed/partial cron runs,
 * repeatedly-failing league webhooks) -- distinct from `discord.ts`, which
 * notifies *leagues* about their own drafts/bids/trades. This posts to a
 * single private ops channel via `OPS_DISCORD_WEBHOOK_URL`.
 *
 * No-op when that env var is unset (e.g. local dev, tests). Never throws --
 * an alert about a failure must not itself become a source of failures.
 */

import { fetchWithTimeout } from './http.ts'
import { createLogger } from './logger.ts'

const log = createLogger('shared/ops-alerts')

/** Discord's hard message-length limit; the fields block is truncated well under it. */
const MAX_FIELDS_CHARS = 1500

export async function alertOps(title: string, fields?: Record<string, unknown>): Promise<void> {
  const webhookUrl = Deno.env.get('OPS_DISCORD_WEBHOOK_URL')
  if (!webhookUrl) return

  try {
    let content = `⚠️ **${title}**`
    if (fields) {
      let block = JSON.stringify(fields, null, 2)
      if (block.length > MAX_FIELDS_CHARS) {
        block = `${block.slice(0, MAX_FIELDS_CHARS)}\n… (truncated)`
      }
      content += `\n\`\`\`json\n${block}\n\`\`\``
    }

    const response = await fetchWithTimeout(
      webhookUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Fantasy Reel Ops', content }),
      },
      5_000
    )

    if (!response.ok) {
      log.warn('Ops alert webhook returned non-OK status', { status: response.status, title })
    }
  } catch (error) {
    // Never let alerting break the caller -- just log a single warn line.
    log.warn('Failed to send ops alert', {
      title,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
