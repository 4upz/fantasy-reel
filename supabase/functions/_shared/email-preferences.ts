/**
 * Opt-out for non-essential email (review finding D14).
 *
 * The season recap (final standings) email is the one email the app sends that
 * isn't a direct response to something the recipient or their league did, so
 * it is the one people can turn off. Each recipient has a random unsubscribe
 * token in `email_preferences`; it backs both the RFC 8058 one-click
 * `List-Unsubscribe` header (mail clients POST to the email-unsubscribe Edge
 * Function) and the footer link (the site's /unsubscribe page, which asks
 * before calling the same function, so link scanners can't unsubscribe anyone).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildSiteUrl } from './discord.ts'

export interface UnsubscribeLinks {
  /** The footer link: a page that confirms before unsubscribing. */
  pageUrl: string
  /** The one-click endpoint mail clients POST to. */
  oneClickUrl: string
}

export function buildUnsubscribeLinks(token: string): UnsubscribeLinks {
  const query = `?token=${encodeURIComponent(token)}`
  return {
    pageUrl: buildSiteUrl(`/unsubscribe${query}`),
    oneClickUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-unsubscribe${query}`,
  }
}

/** The headers Gmail and Yahoo require for one-click unsubscribe. */
export function listUnsubscribeHeaders(links: UnsubscribeLinks): Record<string, string> {
  return {
    'List-Unsubscribe': `<${links.oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * Unsubscribe tokens of the users who still want season recap emails, creating
 * the default (opted-in) row for anyone who has none yet. Users missing from
 * the result must not be emailed. Throws if preferences can't be read: without
 * them there is no way to honour an opt-out, so the caller sends nothing.
 */
export async function seasonRecapTokens(
  serviceClient: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const { data, error } = await serviceClient.rpc('ensure_email_preferences', { p_user_ids: userIds })
  if (error) throw error

  const tokens = new Map<string, string>()
  for (const row of (data ?? []) as { user_id: string; season_recap_emails: boolean; unsubscribe_token: string }[]) {
    if (row.season_recap_emails) tokens.set(row.user_id, row.unsubscribe_token)
  }
  return tokens
}
