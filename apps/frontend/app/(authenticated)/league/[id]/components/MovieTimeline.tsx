'use client'

import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MovieTimelineCard from './MovieTimelineCard'
import type { MovieTimelineItem, League } from '@/types'

interface Props {
  movies: MovieTimelineItem[]
  leagueStatus: League['status']
  onMovieClick?: (movie: MovieTimelineItem) => void
}

/** @design-system League */
export default function MovieTimeline({ movies, leagueStatus, onMovieClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    const scrollAmount = 300
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  // Empty state for setup phase
  if (leagueStatus === 'setup') {
    return (
      <div className="card p-8 text-center">
        <div className="flex justify-center gap-4 mb-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="w-24 h-36 rounded-lg bg-elevated border border-border animate-pulse"
            />
          ))}
        </div>
        <p className="text-foreground-muted">
          Your movies will appear here after the draft
        </p>
      </div>
    )
  }

  // Empty state for drafting phase with no picks yet
  if (movies.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-foreground-muted">
          {leagueStatus === 'drafting'
            ? 'Draft your first movie to see it here'
            : 'No movies on your roster yet'}
        </p>
      </div>
    )
  }

  // Sort movies by release date
  const sortedMovies = [...movies].sort((a, b) => {
    if (!a.release_date) return 1
    if (!b.release_date) return -1
    return new Date(a.release_date).getTime() - new Date(b.release_date).getTime()
  })

  // Find today's position for the marker
  const today = new Date()
  const todayIndex = sortedMovies.findIndex((m) => {
    if (!m.release_date) return false
    return new Date(m.release_date) > today
  })

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-foreground">
          Movie Timeline
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => scroll('left')}
            className="p-1.5 rounded-lg bg-elevated hover:bg-surface-hover transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1.5 rounded-lg bg-elevated hover:bg-surface-hover transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Timeline Line */}
        <div className="absolute top-[18px] left-0 right-0 h-px bg-border" />

        {/* Today Marker */}
        {todayIndex > 0 && (
          <div
            className="absolute top-0 h-full w-px bg-gold z-10"
            style={{
              left: `${(todayIndex / sortedMovies.length) * 100}%`,
            }}
          >
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-gold whitespace-nowrap">
              Today
            </span>
          </div>
        )}

        {/* Scrollable Container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-4 pt-8 scrollbar-hide scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {sortedMovies.map((movie) => (
            <MovieTimelineCard
              key={movie.id}
              movie={movie}
              onClick={() => onMovieClick?.(movie)}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <span className="text-foreground-muted">●</span> Scored
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-gold">◐</span> Releasing Soon
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-foreground-muted">○</span> Upcoming
        </span>
      </div>
    </div>
  )
}
