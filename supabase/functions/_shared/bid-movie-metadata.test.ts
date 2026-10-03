import { assertEquals } from '@std/assert'
import { bidMovieDataFromDetails, bidMovieDataFromRow } from './bid-movie-metadata.ts'
import type { MovieDetailsResponse } from './movie-details.ts'

const details: MovieDetailsResponse = {
  tmdb_id: 42, imdb_id: null, title: '  Canonical Title ', tagline: null, overview: 'Plot',
  release_date: '', runtime: null, status: 'Planned', poster_url: 'https://image.tmdb.org/t/p/w500/p.jpg',
  backdrop_url: null, vote_average: 7.5, vote_count: 10, genres: [{ id: 28, name: 'Action' }],
  cast: [], director: null,
}

Deno.test('bidMovieDataFromDetails keeps only canonical display fields', () => {
  assertEquals(bidMovieDataFromDetails(details), {
    title: 'Canonical Title',
    overview: 'Plot',
    poster_url: 'https://image.tmdb.org/t/p/w500/p.jpg',
    release_date: null,
    vote_average: 7.5,
    popularity: 0,
    genre_ids: [28],
  })
})

Deno.test('bidMovieDataFromRow defaults missing numbers', () => {
  assertEquals(bidMovieDataFromRow({
    title: 'Row Title', overview: null, poster_url: null, release_date: '2099-01-01',
    vote_average: null, popularity: null,
  }), {
    title: 'Row Title', overview: null, poster_url: null, release_date: '2099-01-01',
    vote_average: 0, popularity: 0, genre_ids: [],
  })
})
