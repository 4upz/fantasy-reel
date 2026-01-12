import { Metadata } from 'next'
import MovieSearchClient from './MovieSearchClient'

export const metadata: Metadata = {
  title: 'Browse Movies | Fantasy Reel',
  description: 'Search and discover movies for your fantasy leagues',
}

export default function MoviesPage() {
  return <MovieSearchClient />
}
