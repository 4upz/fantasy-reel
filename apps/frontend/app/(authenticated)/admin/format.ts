/** Display helpers shared by the admin page and its chart. */

export const count = (n: number) => n.toLocaleString('en-US')

/** A YYYY-MM-DD bucket from the RPC, formatted in UTC so it never shifts a day. */
export const utcDate = (isoDate: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
