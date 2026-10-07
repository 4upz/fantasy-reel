'use client'

import { useId } from 'react'
import { X } from 'lucide-react'
import Modal from '@/app/components/Modal'
import MovieDetailBody from '@/app/components/MovieDetailBody'
import type { TMDbSearchResult, TMDbMovieDetails } from '@/types'

interface Props {
  movie: TMDbSearchResult
  details: TMDbMovieDetails | null
  loading: boolean
  onClose: () => void
}

/** @design-system Movies */
export default function MovieDetailModal({ movie, details, loading, onClose }: Props) {
  const titleId = useId()

  return (
    <Modal onClose={onClose} labelledBy={titleId} closeOnBackdrop>
      <div className="relative w-full max-w-4xl animate-slide-up motion-reduce:animate-none">
        <div className="card bg-surface overflow-hidden">
          <button
            type="button"
            onClick={onClose}
            data-dialog-initial-focus
            className="absolute top-4 right-4 p-2 rounded-full bg-background/50 backdrop-blur-sm border border-border text-foreground-secondary hover:text-foreground hover:border-border-hover transition-all z-10"
            aria-label="Close movie details"
          >
            <X className="w-5 h-5" />
          </button>

          <MovieDetailBody movie={movie} details={details} loading={loading} titleId={titleId} />
        </div>
      </div>
    </Modal>
  )
}
