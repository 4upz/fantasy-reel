export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 1) + '\u2026'
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}
