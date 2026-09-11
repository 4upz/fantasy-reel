import type { FranchiseHistory } from '@/types'

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/**
 * TMDb names nearly every collection "<Series> Collection". In a sentence
 * ("5th Shrek film") that suffix is noise, so it is dropped; the full name
 * still appears where the collection is the subject.
 */
export function seriesName(history: FranchiseHistory): string {
  return history.collection_name.replace(/\s+collection$/i, '')
}

/**
 * "5th Shrek film". A leading article is dropped as well -- "5th The Avengers
 * film" reads like a typo, "5th Avengers film" like a sentence.
 */
export function entryLabel(history: FranchiseHistory): string {
  const name = seriesName(history).replace(/^(the|a|an)\s+/i, '')
  return `${ordinal(history.entry_number)} ${name} film`
}
