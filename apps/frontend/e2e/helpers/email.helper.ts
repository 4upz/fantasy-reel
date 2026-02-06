/**
 * Email helper for reading test emails from Mailpit
 * Local Supabase uses Mailpit for email capture at http://127.0.0.1:54324
 */

const MAILPIT_URL = process.env.INBUCKET_URL || 'http://127.0.0.1:54324'

/**
 * Mailpit message list response
 */
interface MailpitListResponse {
  total: number
  messages: MailpitMessage[]
}

interface MailpitMessage {
  ID: string
  Subject: string
  Created: string
  From: { Name: string; Address: string }
  To: Array<{ Name: string; Address: string }>
}

interface MailpitMessageDetail {
  ID: string
  Subject: string
  Text: string
  HTML: string
  To: Array<{ Name: string; Address: string }>
}

interface EmailContent {
  subject: string
  body: string
  html?: string
  links: string[]
}

interface EmailBaseline {
  lastEmailId: string | null
}

/**
 * Capture the current mailbox state as a baseline
 * Call this BEFORE triggering an action that sends an email
 * @param email - The email address to check
 * @returns Baseline with the ID of the most recent email (or null if empty)
 */
export async function captureEmailBaseline(
  email: string
): Promise<EmailBaseline> {
  try {
    // Mailpit search by recipient email
    const searchUrl = `${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`
    const listRes = await fetch(searchUrl)

    if (!listRes.ok) {
      return { lastEmailId: null }
    }

    const response: MailpitListResponse = await listRes.json()

    if (response.messages && response.messages.length > 0) {
      // Return the ID of the most recent email (first in list, sorted by date desc)
      return { lastEmailId: response.messages[0].ID }
    }
  } catch {
    // If we can't fetch, assume empty mailbox
  }

  return { lastEmailId: null }
}

/**
 * Wait for a NEW email that arrived after the baseline
 * @param email - The email address to check
 * @param baseline - Baseline from captureEmailBaseline()
 * @param timeout - Maximum time to wait for email (ms)
 * @returns The new email content
 */
export async function waitForNewEmail(
  email: string,
  baseline: EmailBaseline,
  timeout = 15000
): Promise<EmailContent> {
  const startTime = Date.now()
  const pollInterval = 500

  while (Date.now() - startTime < timeout) {
    try {
      // Mailpit search by recipient email
      const searchUrl = `${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`
      const listRes = await fetch(searchUrl)

      if (!listRes.ok) {
        throw new Error(`Failed to fetch mailbox: ${listRes.status}`)
      }

      const response: MailpitListResponse = await listRes.json()

      if (response.messages && response.messages.length > 0) {
        // Find the latest email (first in list)
        const latest = response.messages[0]

        // Check if this is a NEW email (different from baseline)
        if (latest.ID !== baseline.lastEmailId) {
          const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`)

          if (!msgRes.ok) {
            throw new Error(`Failed to fetch message: ${msgRes.status}`)
          }

          const message: MailpitMessageDetail = await msgRes.json()

          // Extract links from body
          const bodyText = message.Text || ''
          const bodyHtml = message.HTML || ''
          const linkRegex = /https?:\/\/[^\s<>"'()]+/g
          const textLinks = bodyText.match(linkRegex) || []
          const htmlLinks = bodyHtml.match(linkRegex) || []
          const links = [...new Set([...textLinks, ...htmlLinks])]

          return {
            subject: message.Subject,
            body: bodyText,
            html: bodyHtml,
            links,
          }
        }
      }
    } catch (error) {
      // Ignore errors during polling, will retry
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(
    `No new email found for ${email} within ${timeout}ms (baseline ID: ${baseline.lastEmailId})`
  )
}

/**
 * Get the latest email for a given email address
 * @param email - The email address to check
 * @param timeout - Maximum time to wait for email (ms)
 * @param pollInterval - Time between checks (ms)
 * @deprecated Use captureEmailBaseline() + waitForNewEmail() instead to avoid stale emails
 */
export async function getLatestEmail(
  email: string,
  timeout = 10000,
  pollInterval = 500
): Promise<EmailContent> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      // Mailpit search by recipient email
      const searchUrl = `${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`
      const listRes = await fetch(searchUrl)

      if (!listRes.ok) {
        throw new Error(`Failed to fetch mailbox: ${listRes.status}`)
      }

      const response: MailpitListResponse = await listRes.json()

      if (response.messages && response.messages.length > 0) {
        // Get latest message (first in list)
        const latest = response.messages[0]
        const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`)

        if (!msgRes.ok) {
          throw new Error(`Failed to fetch message: ${msgRes.status}`)
        }

        const message: MailpitMessageDetail = await msgRes.json()

        // Extract links from body
        const bodyText = message.Text || ''
        const bodyHtml = message.HTML || ''
        const linkRegex = /https?:\/\/[^\s<>"'()]+/g
        const textLinks = bodyText.match(linkRegex) || []
        const htmlLinks = bodyHtml.match(linkRegex) || []
        const links = [...new Set([...textLinks, ...htmlLinks])]

        return {
          subject: message.Subject,
          body: bodyText,
          html: bodyHtml,
          links,
        }
      }
    } catch (error) {
      // Ignore errors during polling, will retry
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(`No emails found for ${email} within ${timeout}ms`)
}

/**
 * Wait for an email with a specific subject
 */
export async function waitForEmailWithSubject(
  email: string,
  subjectContains: string,
  timeout = 15000
): Promise<EmailContent> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      // Mailpit search by recipient email
      const searchUrl = `${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`
      const listRes = await fetch(searchUrl)
      const response: MailpitListResponse = await listRes.json()

      // Find message with matching subject
      const matching = response.messages?.find((m) =>
        m.Subject.toLowerCase().includes(subjectContains.toLowerCase())
      )

      if (matching) {
        const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${matching.ID}`)
        const message: MailpitMessageDetail = await msgRes.json()

        const bodyText = message.Text || ''
        const bodyHtml = message.HTML || ''
        const linkRegex = /https?:\/\/[^\s<>"'()]+/g
        const links = [
          ...new Set([
            ...(bodyText.match(linkRegex) || []),
            ...(bodyHtml.match(linkRegex) || []),
          ]),
        ]

        return {
          subject: message.Subject,
          body: bodyText,
          html: bodyHtml,
          links,
        }
      }
    } catch {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `No email with subject containing "${subjectContains}" found for ${email}`
  )
}

/**
 * Clear emails for a specific email address in Mailpit
 * Only deletes messages addressed to the given email, preserving other workers' emails.
 * This is critical for parallel test execution.
 */
export async function clearMailbox(email: string): Promise<void> {
  try {
    // Search for messages to this specific email address
    const searchUrl = `${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`
    const listRes = await fetch(searchUrl)

    if (!listRes.ok) {
      return // No emails to clear
    }

    const response: MailpitListResponse = await listRes.json()

    if (!response.messages || response.messages.length === 0) {
      return // No emails to clear
    }

    // Delete only messages for this specific email address
    // Mailpit supports bulk delete by passing message IDs
    const messageIds = response.messages.map((msg) => msg.ID)

    // Use the delete endpoint with IDs
    await fetch(`${MAILPIT_URL}/api/v1/messages`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: messageIds }),
    })
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Extract confirmation/reset link from email
 */
export function extractAuthLink(
  email: EmailContent,
  type: 'confirm' | 'reset' | 'invite'
): string | null {
  // Supabase uses /auth/confirm with type query param for both confirm and reset
  // - Email confirmation: /auth/confirm?...type=signup
  // - Password reset: /auth/confirm?...type=recovery (or /auth/v1/verify?...type=recovery)
  const patterns: Record<string, RegExp> = {
    confirm: /\/auth\/(?:v1\/)?(?:confirm|verify)\?[^\s<>"'()]+type=(?:signup|email)[^\s<>"'()]*/,
    reset: /\/auth\/(?:v1\/)?(?:confirm|verify)\?[^\s<>"'()]+type=recovery[^\s<>"'()]*/,
    invite: /\/join\?token=[^\s<>"'()]+/,
  }

  const pattern = patterns[type]
  const fullText = email.body + (email.html || '')
  const match = fullText.match(pattern)

  if (match) {
    // Ensure we have a full URL - extract it properly
    let link = match[0]
    // Clean up any trailing parentheses or HTML artifacts
    link = link.replace(/[)>]+$/, '')

    if (link.startsWith('http')) {
      return link
    }
    return `http://127.0.0.1:54321${link}`
  }

  // Fallback: check extracted links
  return (
    email.links.find((l) => {
      if (type === 'confirm')
        return (
          (l.includes('/auth/confirm') || l.includes('/auth/v1/verify')) &&
          (l.includes('type=signup') || l.includes('type=email'))
        )
      if (type === 'reset')
        return (
          (l.includes('/auth/confirm') || l.includes('/auth/v1/verify')) &&
          l.includes('type=recovery')
        )
      if (type === 'invite') return l.includes('/join?token=')
      return false
    }) || null
  )
}
