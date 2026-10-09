/**
 * A join code as someone typed it: uppercased, with the spaces and dashes people
 * add for readability dropped. Any other mistyped character (O for 0, say) is
 * kept: silently discarding it would leave a screen-reader user with a code that
 * doesn't match what they typed, so validation reports it instead.
 */
export function normalizeJoinCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '')
}

/**
 * Where to send someone who entered a code outside the /join page. A bare join
 * code, or a pasted join link, goes to the join-code flow. A pasted email
 * invitation link keeps its token, since invitations are a separate flow that
 * only accepts tokens.
 */
export function joinPathFromInput(input: string): string {
  const value = input.trim()
  const params = linkParams(value)

  const token = params.get('token')
  if (token) return `/join?token=${encodeURIComponent(token)}`

  const code = normalizeJoinCode(params.get('code') ?? value)
  return `/join?code=${encodeURIComponent(code)}`
}

function linkParams(value: string): URLSearchParams {
  try {
    // The base lets a link pasted without its scheme (fantasyreel.com/join?code=…) parse too
    return new URL(value, 'https://link.invalid').searchParams
  } catch {
    return new URLSearchParams()
  }
}
