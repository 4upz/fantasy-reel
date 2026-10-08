/**
 * Curated distributor/label map for the projections corpus
 * (`film_corpus.label_id`).
 *
 * Raw TMDb production companies are mostly financiers and shell companies,
 * which dilutes any "studio" signal. What predicts critical reception is the
 * label behind a release (A24, Neon, Searchlight...), so each film is reduced
 * to one key from this list, or 'other' when it has companies but none of
 * them is listed.
 *
 * Matched on TMDb's company *name* (case-insensitive, exact alias), not id:
 * names are what an operator can check by eye, and a wrong hand-typed id would
 * silently mislabel. Order matters -- the first label any of a film's
 * companies matches wins, so specialty labels and franchise studios come
 * before the majors that own or distribute them (a Marvel film is 'marvel',
 * not 'disney').
 *
 * Changing a key or its aliases changes historical labels: re-run the
 * corpus metadata refresh (clear metadata_fetched_at) after editing.
 */

export const OTHER_LABEL = 'other'

/** [label key, TMDb company names that map to it], in precedence order. */
export const FILM_LABELS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // Specialty and independent labels
  ['a24', ['a24']],
  ['neon', ['neon']],
  ['searchlight', ['searchlight pictures', 'fox searchlight pictures']],
  ['focus', ['focus features']],
  ['sony_classics', ['sony pictures classics']],
  ['ifc', ['ifc films', 'ifc productions']],
  ['magnolia', ['magnolia pictures']],
  ['annapurna', ['annapurna pictures']],
  ['bleecker_street', ['bleecker street']],
  ['roadside', ['roadside attractions']],
  ['mubi', ['mubi']],
  ['blumhouse', ['blumhouse productions']],
  ['plan_b', ['plan b entertainment']],
  // Animation
  ['pixar', ['pixar']],
  ['disney_animation', ['walt disney animation studios']],
  ['dreamworks_animation', ['dreamworks animation']],
  ['illumination', ['illumination', 'illumination entertainment']],
  ['sony_animation', ['sony pictures animation']],
  ['warner_animation', ['warner bros. animation', 'warner animation group']],
  // Franchise studios
  ['marvel', ['marvel studios']],
  ['lucasfilm', ['lucasfilm ltd.', 'lucasfilm']],
  ['dc', ['dc studios', 'dc films', 'dc entertainment']],
  // Majors
  ['disney', ['walt disney pictures']],
  ['warner', ['warner bros. pictures', 'warner bros.']],
  ['new_line', ['new line cinema']],
  ['universal', ['universal pictures']],
  ['paramount', ['paramount pictures', 'paramount']],
  ['columbia', ['columbia pictures', 'sony pictures', 'sony pictures releasing']],
  ['twentieth_century', ['20th century studios', '20th century fox']],
  ['lionsgate', ['lionsgate', 'lions gate films', 'summit entertainment']],
  ['mgm', ['metro-goldwyn-mayer', 'united artists releasing', 'amazon mgm studios']],
  ['legendary', ['legendary pictures', 'legendary entertainment']],
  // Streamers
  ['netflix', ['netflix']],
  ['amazon', ['amazon studios']],
  ['apple', ['apple studios', 'apple original films']],
]

const LABEL_BY_NAME = new Map<string, { key: string; rank: number }>(
  FILM_LABELS.flatMap(([key, names], rank) => names.map((name) => [name, { key, rank }] as const))
)

/**
 * One label key for a film's production companies: the highest-precedence
 * listed label, 'other' for unlisted companies, null when TMDb lists none.
 */
export function labelForCompanies(companies: ReadonlyArray<{ name: string }>): string | null {
  if (companies.length === 0) return null
  let best: { key: string; rank: number } | undefined
  for (const company of companies) {
    const match = LABEL_BY_NAME.get(company.name.trim().toLowerCase())
    if (match && (!best || match.rank < best.rank)) best = match
  }
  return best?.key ?? OTHER_LABEL
}
