// Shared preview fixtures. Not a component preview — the converter iterates
// the component list, so a leading-underscore module here is simply ignored.
//
// Names and teams follow the repo's own seeded test users
// (supabase/seed.sql): Alice Spielberg, Bob Nolan, Carol Coppola,
// Dave Kubrick. Movie data is curated from FALLBACK_MOVIES in
// apps/frontend/app/components/landing/data.ts.

/** Dates that stay correct under any clock — the screenshot harness pins the
    browser clock to a different date than the live design pane uses. */
export const daysOut = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

export const POSTERS = {
  dune: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  apes: 'https://image.tmdb.org/t/p/w500/gKkl37BQuKTanygYQG1pyYgLVgf.jpg',
  garfield: 'https://image.tmdb.org/t/p/w500/p6AbOJvMQhBmffd0PIv0u8ghWeY.jpg',
  godzilla: 'https://image.tmdb.org/t/p/w500/z1p34vh7dEOnLDmyCrlUVLuoDzd.jpg',
  badBoys: 'https://image.tmdb.org/t/p/w500/nP6RliHjxsz4irTKsxe8FRhKZYl.jpg',
  quietPlace: 'https://image.tmdb.org/t/p/w500/hU42CRk14JuPEdqZG3AWmagiPAP.jpg',
}

export const movie = (
  over: Partial<{
    tmdb_id: number
    title: string
    overview: string | null
    release_date: string | null
    poster_url: string | null
    vote_average: number
    popularity: number
    genre_ids: number[]
  }> = {}
) => ({
  tmdb_id: 693134,
  title: 'Dune: Part Two',
  overview: 'Follow the mythic journey of Paul Atreides.',
  release_date: daysOut(30),
  poster_url: POSTERS.dune,
  vote_average: 8.4,
  popularity: 1200,
  genre_ids: [878, 12],
  ...over,
})

export const team = (over: Partial<{ id: string; name: string; avatar_url: string | null }> = {}) => ({
  id: 'aaaaaaa1-1111-4111-8111-111111111111',
  participant_id: 'ppppppp1-1111-4111-8111-111111111111',
  name: 'The Spielbergs',
  avatar_url: null,
  created_at: '2026-01-04T10:00:00Z',
  updated_at: '2026-01-04T10:00:00Z',
  ...over,
})

export const TEAM_NAMES = [
  'The Spielbergs',
  'Nolan’s Eleven',
  'The Godfathers',
  'Kubrick’s Odyssey',
]

export const PROFILE_NAMES = ['Alice Spielberg', 'Bob Nolan', 'Carol Coppola', 'Dave Kubrick']
