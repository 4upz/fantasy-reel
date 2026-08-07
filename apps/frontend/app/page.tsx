import HeroSection from './components/landing/HeroSection'
import UiPreview from './components/landing/UiPreview'
import ScoringReveal from './components/landing/ScoringReveal'
import MovieShowcase from './components/landing/MovieShowcase'
import CTAFooter from './components/landing/CTAFooter'
import SiteFooter from './components/landing/SiteFooter'
import { generateTickerEntries, FALLBACK_MOVIES } from './components/landing/data'
import type { TMDbSearchResult } from '@/types'

// Fetch upcoming movies from TMDb API at build time
async function getUpcomingMovies(): Promise<TMDbSearchResult[]> {
  const tmdbToken = process.env.TMDB_API_KEY

  if (!tmdbToken) {
    console.warn('TMDB_API_KEY not configured, using fallback movies')
    return FALLBACK_MOVIES
  }

  try {
    const today = new Date()
    const futureDate = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000) // 6 months out

    const url = new URL('https://api.themoviedb.org/3/discover/movie')
    url.searchParams.set('language', 'en-US')
    url.searchParams.set('region', 'US')
    url.searchParams.set('include_adult', 'false')
    url.searchParams.set('certification_country', 'US')
    url.searchParams.set('certification.lte', 'R')
    url.searchParams.set('sort_by', 'popularity.desc')
    url.searchParams.set('primary_release_date.gte', today.toISOString().split('T')[0])
    url.searchParams.set('primary_release_date.lte', futureDate.toISOString().split('T')[0])
    url.searchParams.set('with_release_type', '2|3')

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${tmdbToken}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 86400 }, // Revalidate once per day
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      console.error('TMDb API error:', response.status)
      return FALLBACK_MOVIES
    }

    const data = await response.json()

    return data.results
      .filter((movie: { adult?: boolean }) => !movie.adult)
      .slice(0, 12)
      .map(
      (movie: {
        id: number
        title: string
        overview: string | null
        release_date: string | null
        poster_path: string | null
        vote_average: number
        popularity: number
        genre_ids: number[]
      }) => ({
        tmdb_id: movie.id,
        title: movie.title,
        overview: movie.overview,
        release_date: movie.release_date,
        poster_url: movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : null,
        vote_average: movie.vote_average,
        popularity: movie.popularity,
        genre_ids: movie.genre_ids,
      })
    )
  } catch (error) {
    console.error('Failed to fetch movies:', error)
    return FALLBACK_MOVIES
  }
}

export default async function LandingPage(): Promise<React.ReactElement> {
  const movies = await getUpcomingMovies()
  const tickerEntries = generateTickerEntries(movies.slice(0, 10))

  return (
    <main>
      <HeroSection tickerEntries={tickerEntries} />
      <UiPreview />
      <ScoringReveal />
      <MovieShowcase movies={movies} />
      <CTAFooter />
      <SiteFooter />
    </main>
  )
}
