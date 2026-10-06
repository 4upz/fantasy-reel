/**
 * A deterministic synthetic film corpus with known structure, for testing the
 * projection model and running its backtest end to end without a database.
 *
 * Each film's true logit score is a sum of effects the model is meant to find
 * (director, writer and cast quality, label, franchise decline, festival,
 * release month, genres, runtime, release type) plus noise, so a working model
 * clearly beats the genre baseline while staying far from perfect.
 *
 * Never used to fit a production model.
 */

import { logitToRt } from './projection-features.ts'
import type { CorpusCredit, CorpusFilm } from './projection-types.ts'

export interface SyntheticCorpusOptions {
  seed?: number
  firstYear?: number
  lastYear?: number
  filmsPerYear?: number
  /** Logit-scale noise per film (default 0.6). */
  noise?: number
  /** Films released within this many days of `asOf` are unsettled (default 60). */
  settleDays?: number
  /** "Today" for settlement, ISO date (default 1 Feb after lastYear). */
  asOf?: string
}

export interface SyntheticCorpus {
  films: CorpusFilm[]
  credits: CorpusCredit[]
}

/** Deterministic uniform [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GENRE_EFFECTS: Array<[number, number, number]> = [
  // [genre id, effect, relative frequency]
  [18, 0.25, 30],
  [35, -0.1, 22],
  [53, -0.15, 15],
  [28, -0.2, 14],
  [27, -0.45, 10],
  [99, 0.7, 6],
  [16, 0.35, 5],
  [10749, -0.05, 8],
  [878, -0.1, 6],
  [80, 0.05, 7],
  [10751, 0, 5],
  [36, 0.2, 3],
]

const LABELS: Array<[string, number]> = [
  ['a24', 0.45],
  ['neon', 0.35],
  ['searchlight', 0.3],
  ['focus', 0.15],
  ['lionsgate', -0.15],
  ['universal', 0],
  ['warner', 0.05],
  ['sony', -0.05],
  ['paramount', -0.1],
  ['disney', 0.1],
]

const FESTIVALS = ['cannes', 'venice', 'tiff', 'sundance', 'berlin', 'telluride', 'sxsw']
const MONTH_EFFECT = [0, -0.35, -0.3, -0.05, 0, 0, 0, 0, -0.05, 0.05, 0.2, 0.25, 0.3]

const pad = (n: number) => String(n).padStart(2, '0')

export function syntheticCorpus(options: SyntheticCorpusOptions = {}): SyntheticCorpus {
  const random = seededRandom(options.seed ?? 42)
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
  const firstYear = options.firstYear ?? 2012
  const lastYear = options.lastYear ?? 2025
  const perYear = options.filmsPerYear ?? 200
  const noise = options.noise ?? 0.6
  const settleDays = options.settleDays ?? 60
  const asOfMs = Date.parse(options.asOf ?? `${lastYear + 1}-02-01`)
  const total = perYear * (lastYear - firstYear + 1)

  const pool = (size: number, spread: number) => Array.from({ length: Math.max(1, Math.round(size)) }, () => spread * gaussian())
  const directors = pool(total / 3, 0.7)
  const writers = pool(total / 3, 0.4)
  const actors = pool(total / 2, 0.25)
  const collections = pool(total / 40, 0.5)
  const collectionEntries = new Map<number, number>()
  const genreWeight = GENRE_EFFECTS.reduce((s, g) => s + g[2], 0)
  const pickGenre = () => {
    let r = random() * genreWeight
    for (const g of GENRE_EFFECTS) {
      r -= g[2]
      if (r <= 0) return g
    }
    return GENRE_EFFECTS[0]
  }

  const films: CorpusFilm[] = []
  const credits: CorpusCredit[] = []
  let nextId = 1000
  for (let year = firstYear; year <= lastYear; year++) {
    const dates = Array.from({ length: perYear }, () => Math.floor(random() * 365))
      .sort((a, b) => a - b)
    for (const dayOfYear of dates) {
      const id = nextId++
      const date = new Date(Date.UTC(year, 0, 1 + dayOfYear))
      const iso = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
      let z = 0.35 + 0.02 * (year - firstYear) * (random() < 0.5 ? 1 : -1)

      const genres = new Map<number, number>()
      const genreCount = 1 + Math.floor(random() * 2.5)
      for (let i = 0; i < genreCount; i++) {
        const [g, effect] = pickGenre()
        genres.set(g, effect)
      }
      z += [...genres.values()].reduce((a, b) => a + b, 0) / Math.sqrt(genres.size)

      const director = Math.floor(random() * directors.length)
      z += directors[director]
      credits.push({ tmdb_id: id, tmdb_person_id: director + 1, role: 'director', billing: null })
      const writerCount = 1 + Math.floor(random() * 2)
      for (let i = 0; i < writerCount; i++) {
        const writer = Math.floor(random() * writers.length)
        z += writers[writer] / writerCount
        credits.push({ tmdb_id: id, tmdb_person_id: 100_000 + writer, role: 'writer', billing: null })
      }
      const castCount = 3 + Math.floor(random() * 3)
      for (let b = 0; b < castCount; b++) {
        const actor = Math.floor(random() * actors.length)
        if (b < 3) z += actors[actor] / 3
        credits.push({ tmdb_id: id, tmdb_person_id: 200_000 + actor, role: 'cast', billing: b })
      }

      const label = random() < 0.7 ? pick(LABELS) : null
      if (label) z += label[1]

      let collectionId: number | null = null
      const keywordFlags: string[] = []
      if (random() < 0.12) {
        const c = Math.floor(random() * collections.length)
        const entry = collectionEntries.get(c) ?? 0
        collectionEntries.set(c, entry + 1)
        collectionId = 5000 + c
        z += collections[c] - 0.25 * entry
        if (entry > 0) keywordFlags.push('sequel')
      }
      if (random() < 0.2) {
        keywordFlags.push('adaptation')
        z += 0.05
      }
      if (random() < 0.05) {
        keywordFlags.push('remake')
        z -= 0.35
      }
      if (random() < 0.08) {
        keywordFlags.push('true_story')
        z += 0.1
      }

      const festival = random() < 0.15 ? pick(FESTIVALS) : null
      if (festival) z += 0.5
      z += MONTH_EFFECT[date.getUTCMonth() + 1]

      const releaseRoll = random()
      const releaseType = releaseRoll < 0.5 ? 3 : releaseRoll < 0.85 ? 2 : 4
      if (releaseType === 4) z -= 0.2
      const runtime = random() < 0.95 ? Math.round(85 + random() * 70) : null
      if (runtime) z += 0.008 * (runtime - 105)
      const budget = random() < 0.6 ? Math.round(10 ** (6 + random() * 2.3)) : null

      z += noise * gaussian()
      const reviews = 20 + Math.floor(random() * 280)
      const rt = Math.round(logitToRt(z))
      const settled = date.getTime() + settleDays * 86_400_000 <= asOfMs
      films.push({
        tmdb_id: id,
        title: `Synthetic ${id}`,
        release_date: festival && releaseType !== 4 ? `${year}-01-01` : iso,
        us_wide_date: releaseType === 3 ? iso : null,
        us_limited_date: releaseType === 2 ? iso : null,
        us_release_type: releaseType,
        collection_id: collectionId,
        genre_ids: [...genres.keys()],
        company_ids: [],
        label_id: label ? label[0] : random() < 0.5 ? 'other' : null,
        festival_premiere: festival,
        keyword_flags: keywordFlags,
        original_language: random() < 0.9 ? 'en' : 'fr',
        budget,
        runtime,
        certification: pick(['G', 'PG', 'PG-13', 'R', 'R', 'NR']),
        rt_critic: rt,
        rt_critic_votes: reviews,
        rt_settled_at: settled ? new Date(date.getTime() + settleDays * 86_400_000).toISOString() : null,
      })
    }
  }
  return { films, credits }
}
