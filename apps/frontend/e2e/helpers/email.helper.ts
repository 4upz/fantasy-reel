/**
 * Email helper for reading test emails from Inbucket
 * Local Supabase uses Inbucket for email capture at http://127.0.0.1:54324
 */

const INBUCKET_URL = process.env.INBUCKET_URL || 'http://127.0.0.1:54324'

interface EmailMessage {
  id: string
  subject: string
  date: string
  from: string
  to: string[]
}

interface EmailContent {
  subject: string
  body: string
  html?: string
  links: string[]
}

/**
 * Get the latest email for a given email address
 * @param email - The email address to check
 * @param timeout - Maximum time to wait for email (ms)
 * @param pollInterval - Time between checks (ms)
 */
export async function getLatestEmail(
  email: string,
  timeout = 10000,
  pollInterval = 500
): Promise<EmailContent> {
  const mailbox = email.split('@')[0]
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      // Get mailbox messages
      const listRes = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailbox}`)
      if (!listRes.ok) {
        throw new Error(`Failed to fetch mailbox: ${listRes.status}`)
      }

      const messages: EmailMessage[] = await listRes.json()

      if (messages.length > 0) {
        // Get latest message (last in array)
        const latest = messages[messages.length - 1]
        const msgRes = await fetch(
          `${INBUCKET_URL}/api/v1/mailbox/${mailbox}/${latest.id}`
        )

        if (!msgRes.ok) {
          throw new Error(`Failed to fetch message: ${msgRes.status}`)
        }

        const message = await msgRes.json()

        // Extract links from body
        const bodyText = message.body?.text || ''
        const bodyHtml = message.body?.html || ''
        const linkRegex = /https?:\/\/[^\s<>"']+/g
        const textLinks = bodyText.match(linkRegex) || []
        const htmlLinks = bodyHtml.match(linkRegex) || []
        const links = [...new Set([...textLinks, ...htmlLinks])]

        return {
          subject: message.subject,
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
  const mailbox = email.split('@')[0]
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const listRes = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailbox}`)
      const messages: EmailMessage[] = await listRes.json()

      // Find message with matching subject
      const matching = messages.find((m) =>
        m.subject.toLowerCase().includes(subjectContains.toLowerCase())
      )

      if (matching) {
        const msgRes = await fetch(
          `${INBUCKET_URL}/api/v1/mailbox/${mailbox}/${matching.id}`
        )
        const message = await msgRes.json()

        const bodyText = message.body?.text || ''
        const bodyHtml = message.body?.html || ''
        const linkRegex = /https?:\/\/[^\s<>"']+/g
        const links = [
          ...new Set([
            ...(bodyText.match(linkRegex) || []),
            ...(bodyHtml.match(linkRegex) || []),
          ]),
        ]

        return {
          subject: message.subject,
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
 * Clear all emails in a mailbox
 */
export async function clearMailbox(email: string): Promise<void> {
  const mailbox = email.split('@')[0]
  await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailbox}`, {
    method: 'DELETE',
  })
}

/**
 * Extract confirmation/reset link from email
 */
export function extractAuthLink(
  email: EmailContent,
  type: 'confirm' | 'reset' | 'invite'
): string | null {
  const patterns: Record<string, RegExp> = {
    confirm: /\/auth\/confirm\?[^\s<>"']+/,
    reset: /\/reset-password\?[^\s<>"']+/,
    invite: /\/join\?token=[^\s<>"']+/,
  }

  const pattern = patterns[type]
  const fullText = email.body + (email.html || '')
  const match = fullText.match(pattern)

  if (match) {
    // Ensure we have a full URL
    const link = match[0]
    if (link.startsWith('http')) {
      return link
    }
    return `http://localhost:3000${link}`
  }

  // Fallback: check extracted links
  return (
    email.links.find((l) => {
      if (type === 'confirm') return l.includes('/auth/confirm')
      if (type === 'reset') return l.includes('/reset-password')
      if (type === 'invite') return l.includes('/join?token=')
      return false
    }) || null
  )
}
