'use client'

import type { TMDbSearchResult } from '@/types'
import MovieCard from './MovieCard'

interface Props {
  movies: TMDbSearchResult[]
  onMovieClick: (movie: TMDbSearchResult) => void
}

export default function MovieGrid({ movies, onMovieClick }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
      {movies.map((movie, index) => (
        <MovieCard
          key={movie.tmdb_id}
          movie={movie}
          onClick={() => onMovieClick(movie)}
          index={index}
        />
      ))}
    </div>
  )
}
