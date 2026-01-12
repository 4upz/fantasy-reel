'use client'

import { useState } from 'react'
import type { Movie } from '@/types'

interface Props {
  movies: Movie[]
  picking: boolean
  onPick: (movieId: string) => void
}

export default function MoviePicker({ movies, picking, onPick }: Props) {
  const [search, setSearch] = useState('')
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)

  const filteredMovies = movies.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase())
  )

  const handleConfirmPick = () => {
    if (selectedMovie) {
      onPick(selectedMovie.id)
      setSelectedMovie(null)
    }
  }

  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-lg font-medium text-foreground mb-3">Select a Movie</h3>

      <input
        type="text"
        placeholder="Search movies..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input mb-4"
      />

      {movies.length === 0 ? (
        <p className="text-foreground-muted text-center py-4">
          No movies available. Movies need to be synced first.
        </p>
      ) : filteredMovies.length === 0 ? (
        <p className="text-foreground-muted text-center py-4">No movies match your search.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-96 overflow-y-auto">
          {filteredMovies.map((movie) => (
            <div
              key={movie.id}
              onClick={() => setSelectedMovie(movie)}
              className={`cursor-pointer rounded-lg overflow-hidden transition-all border ${
                selectedMovie?.id === movie.id
                  ? 'border-gold ring-2 ring-gold-muted shadow-glow-gold'
                  : 'border-border hover:border-border-hover'
              }`}
            >
              {movie.poster_url ? (
                <img
                  src={movie.poster_url}
                  alt={movie.title}
                  className="w-full h-40 object-cover"
                />
              ) : (
                <div className="w-full h-40 bg-elevated flex items-center justify-center">
                  <span className="text-4xl">🎬</span>
                </div>
              )}
              <div className="p-2 bg-surface">
                <p className="text-sm font-medium text-foreground truncate" title={movie.title}>
                  {movie.title}
                </p>
                <p className="text-xs text-foreground-muted">
                  {movie.release_date
                    ? new Date(movie.release_date).toLocaleDateString()
                    : 'TBA'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedMovie && (
        <div className="mt-4 p-4 bg-gold-muted rounded-lg border border-gold">
          <div className="flex items-start gap-4">
            {selectedMovie.poster_url && (
              <img
                src={selectedMovie.poster_url}
                alt={selectedMovie.title}
                className="w-16 h-24 object-cover rounded"
              />
            )}
            <div className="flex-1">
              <p className="font-semibold text-lg text-foreground">{selectedMovie.title}</p>
              <p className="text-sm text-foreground-secondary">
                Release: {selectedMovie.release_date || 'TBA'}
              </p>
              {selectedMovie.overview && (
                <p className="text-sm text-foreground-muted mt-1 line-clamp-2">
                  {selectedMovie.overview}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleConfirmPick}
              disabled={picking}
              className="btn btn-primary flex-1"
            >
              {picking ? 'Making Pick...' : 'Confirm Pick'}
            </button>
            <button
              onClick={() => setSelectedMovie(null)}
              disabled={picking}
              className="btn btn-ghost px-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
