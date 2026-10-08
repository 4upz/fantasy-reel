/**
 * Types shared by the projection model, its backtest, and (later) the
 * fit-projection-model cron and get-movie-projections Edge Function.
 *
 * `CorpusFilm` / `CorpusCredit` are the `film_corpus` / `film_credits` rows the
 * model reads, and `MovieProjection` is what get-movie-projections returns per
 * movie. All three are binding handoff contracts between the projection
 * branches: change them only together with the other side.
 */

/** A `film_corpus` row: one historical or upcoming film. */
export interface CorpusFilm {
  tmdb_id: number
  title: string
  /** TMDb primary date (often a festival or overseas date). */
  release_date: string | null
  us_wide_date: string | null
  us_limited_date: string | null
  /** 2 limited, 3 wide, 4 digital. */
  us_release_type: number | null
  collection_id: number | null
  genre_ids: number[]
  company_ids: number[]
  /** Curated distributor key, e.g. 'a24', 'neon', 'searchlight', 'other'. */
  label_id: string | null
  /** e.g. 'cannes', 'venice', 'tiff', 'sundance', 'berlin', 'telluride', 'sxsw'. */
  festival_premiere: string | null
  /** Subset of 'adaptation', 'remake', 'sequel', 'true_story'. */
  keyword_flags: string[]
  original_language: string | null
  budget: number | null
  runtime: number | null
  certification: string | null
  /** 0-100 Tomatometer. */
  rt_critic: number | null
  rt_critic_votes: number | null
  /** Training label eligible when set (>= 20 reviews AND >= 60 days past release). */
  rt_settled_at: string | null
}

/** A `film_credits` row. `billing` is the cast order (0 = top billing), null for crew. */
export interface CorpusCredit {
  tmdb_id: number
  tmdb_person_id: number
  role: 'director' | 'writer' | 'cast'
  billing: number | null
}

/** One factor's share of a projection, in RT points. Baseline + every delta = projected_rt. */
export interface ProjectionContribution {
  factor: string
  label: string
  delta_rt: number
}

/** get-movie-projections' per-movie payload. */
export interface MovieProjection {
  tmdb_id: number
  /** Point estimate 0-100, one decimal. */
  projected_rt: number
  /** Middle 50%, calibrated. */
  range50: [number, number]
  range80: [number, number]
  /** range50 wider than 10 points: the chip shows the point estimate + "Low confidence". */
  low_confidence: boolean
  /** coverage < 0.25: "Not enough history yet", no number. */
  insufficient_history: boolean
  p_rotten: number
  p_fresh: number
  p_90: number
  /** Already resolved for this league's double_points_over_90. */
  expected_points: number
  /** Genre baseline, for the stacked bar. */
  baseline_rt: number
  contributions: ProjectionContribution[]
  /** 0..1 */
  coverage: number
  /** Predecessors still being ingested. */
  partial: boolean
  includes_early_reviews: boolean
  early_rt: { score: number; reviews: number } | null
  computed_at: string
}

export type GetMovieProjectionsResponse =
  | { enabled: false }
  | { enabled: true; model_version: number; projections: Record<string, MovieProjection | null> }
