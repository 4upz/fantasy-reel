'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { TMDB_GENRES } from '@/types'
import { SearchIcon, ChevronDownIcon, CloseIcon, CheckIcon, SpinnerIcon } from './Icons'
import { cn } from './utils'

interface Props {
  onFiltersChange: (filters: DraftFilters) => void
  totalResults?: number
  loading?: boolean
}

export interface DraftFilters {
  releaseWindow: 'all' | 'next30' | 'quarter' | 'year'
  genres: number[]
  minRating: number
  search: string
}

const RELEASE_WINDOWS = [
  { value: 'all', label: 'All Upcoming' },
  { value: 'next30', label: 'Next 30 Days' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
] as const

/** @design-system Movies */
export default function DraftFilters({ onFiltersChange, totalResults, loading }: Props) {
  const [search, setSearch] = useState('')
  const [releaseWindow, setReleaseWindow] = useState<DraftFilters['releaseWindow']>('year')
  const [selectedGenres, setSelectedGenres] = useState<number[]>([])
  const [minRating, setMinRating] = useState(0)
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)
  const genreDropdownRef = useRef<HTMLDivElement>(null)

  // Stable callback ref to avoid triggering effects on callback changes
  const onFiltersChangeRef = useRef(onFiltersChange)
  onFiltersChangeRef.current = onFiltersChange

  const notifyFiltersChange = useCallback(
    (filters: DraftFilters) => {
      onFiltersChangeRef.current(filters)
    },
    []
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (genreDropdownRef.current && !genreDropdownRef.current.contains(event.target as Node)) {
        setShowGenreDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Notify parent of filter changes immediately (hook handles debouncing)
  useEffect(() => {
    notifyFiltersChange({ releaseWindow, genres: selectedGenres, minRating, search })
  }, [search, releaseWindow, selectedGenres, minRating, notifyFiltersChange])

  function toggleGenre(genreId: number): void {
    setSelectedGenres((prev) =>
      prev.includes(genreId) ? prev.filter((id) => id !== genreId) : [...prev, genreId]
    )
  }

  function clearFilters(): void {
    setSearch('')
    setReleaseWindow('year')
    setSelectedGenres([])
    setMinRating(0)
  }

  const hasActiveFilters =
    search !== '' || releaseWindow !== 'year' || selectedGenres.length > 0 || minRating > 0

  const genreButtonLabel = selectedGenres.length > 0
    ? `${selectedGenres.length} Genre${selectedGenres.length > 1 ? 's' : ''}`
    : 'All Genres'

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <SearchIcon className="w-5 h-5 text-foreground-muted" />
        </div>
        <input
          type="text"
          placeholder="Search upcoming movies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-12 pr-4 py-3 text-base"
          data-testid="movie-search-input"
        />
        {loading && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
            <SpinnerIcon className="w-5 h-5 text-gold" />
          </div>
        )}
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Release Window Dropdown */}
        <select
          value={releaseWindow}
          onChange={(e) => setReleaseWindow(e.target.value as DraftFilters['releaseWindow'])}
          className="bg-elevated border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:border-gold focus:ring-1 focus:ring-gold outline-none cursor-pointer transition-all hover:border-border-hover"
        >
          {RELEASE_WINDOWS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {/* Genre Multi-Select */}
        <div className="relative" ref={genreDropdownRef}>
          <button
            onClick={() => setShowGenreDropdown(!showGenreDropdown)}
            className={cn(
              'flex items-center gap-2 bg-elevated border rounded-lg px-4 py-2 text-sm transition-all hover:border-border-hover',
              selectedGenres.length > 0 ? 'border-gold text-gold' : 'border-border text-foreground-secondary'
            )}
          >
            <span>{genreButtonLabel}</span>
            <ChevronDownIcon className={cn('w-4 h-4 transition-transform', showGenreDropdown && 'rotate-180')} />
          </button>

          {showGenreDropdown && (
            <div className="absolute top-full left-0 mt-2 w-64 max-h-72 overflow-y-auto bg-surface border border-border rounded-xl shadow-heavy z-50 animate-fade-in">
              <div className="p-2">
                {selectedGenres.length > 0 && (
                  <button
                    onClick={() => setSelectedGenres([])}
                    className="w-full px-3 py-2 text-left text-sm text-crimson hover:bg-elevated rounded-lg transition-colors mb-1"
                  >
                    Clear selection
                  </button>
                )}
                {TMDB_GENRES.map((genre) => {
                  const isSelected = selectedGenres.includes(genre.id)
                  return (
                    <button
                      key={genre.id}
                      onClick={() => toggleGenre(genre.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded-lg transition-all',
                        isSelected ? 'bg-gold-muted text-gold' : 'text-foreground-secondary hover:bg-elevated hover:text-foreground'
                      )}
                    >
                      <span
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                          isSelected ? 'bg-gold border-gold' : 'border-border-hover'
                        )}
                      >
                        {isSelected && <CheckIcon className="w-3 h-3 text-background" />}
                      </span>
                      {genre.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Min Rating Slider */}
        <div className="flex items-center gap-3 bg-elevated border border-border rounded-lg px-4 py-2">
          <span className="text-sm text-foreground-muted whitespace-nowrap">Min Rating</span>
          <input
            type="range"
            min="0"
            max="8"
            step="0.5"
            value={minRating}
            onChange={(e) => setMinRating(parseFloat(e.target.value))}
            className="w-20 h-1.5 bg-border rounded-full appearance-none cursor-pointer accent-gold [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gold [&::-webkit-slider-thumb]:shadow-md"
          />
          <span className={cn('text-sm font-medium w-8', minRating > 0 ? 'text-gold' : 'text-foreground-muted')}>
            {minRating > 0 ? minRating.toFixed(1) : 'Any'}
          </span>
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-sm text-foreground-muted hover:text-crimson transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
            Clear filters
          </button>
        )}

        {/* Results Count */}
        {totalResults !== undefined && (
          <div className="ml-auto text-sm text-foreground-muted">
            <span className="text-foreground font-medium">{totalResults}</span> movies
          </div>
        )}
      </div>

      {/* Active Genre Chips */}
      {selectedGenres.length > 0 && (
        <div className="flex flex-wrap gap-2 animate-fade-in">
          {selectedGenres.map((genreId) => {
            const genre = TMDB_GENRES.find((g) => g.id === genreId)
            return (
              <button
                key={genreId}
                onClick={() => toggleGenre(genreId)}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-gold-muted border border-gold rounded-full text-sm text-gold hover:bg-gold hover:text-background transition-all group"
              >
                {genre?.name}
                <CloseIcon className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
