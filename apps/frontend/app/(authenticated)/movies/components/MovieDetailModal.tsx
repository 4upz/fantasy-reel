'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import MovieDetailBody from '@/app/components/MovieDetailBody'
import type { TMDbSearchResult, TMDbMovieDetails } from '@/types'

interface Props {
  movie: TMDbSearchResult
  details: TMDbMovieDetails | null
  loading: boolean
  onClose: () => void
}

export default function MovieDetailModal({ movie, details, loading, onClose }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div className="relative z-10 w-full max-w-4xl mx-4 my-8 sm:my-12 animate-slide-up">
        <div className="card bg-surface overflow-hidden">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-background/50 backdrop-blur-sm border border-border text-foreground-muted hover:text-foreground hover:border-border-hover transition-all z-10"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          <MovieDetailBody movie={movie} details={details} loading={loading} />
        </div>
      </div>
    </div>
  )
}
