'use client'

import { useState, useRef, useEffect, useId } from 'react'
import { TMDB_GENRES } from '@/types'
import { SearchIcon, ChevronDownIcon, CloseIcon, CheckIcon, SpinnerIcon } from './Icons'
import { cn } from './utils'

interface Props {
  value: DraftFilters
  onFiltersChange: (filters: DraftFilters) => void
  countLabel: string
  loading?: boolean
  disabledReason?: string
}

export interface DraftFilters {
  releaseWindow: 'all' | 'next30' | 'quarter' | 'year'
  genres: number[]
  search: string
}

const RELEASE_WINDOWS = [
  { value: 'all', label: `Through ${new Date().getUTCFullYear() + 2}` },
  { value: 'next30', label: 'Next 30 Days' },
  { value: 'quarter', label: 'Next 90 Days' },
  { value: 'year', label: 'This Year' },
] as const

/** @design-system Movies */
export default function DraftFilters({ value, onFiltersChange, countLabel, loading, disabledReason }: Props) {
  const { search, releaseWindow, genres: selectedGenres } = value
  const descriptionId = useId()
  const genreListId = useId()
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)
  const genreDropdownRef = useRef<HTMLDivElement>(null)

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

  function toggleGenre(genreId: number): void {
    onFiltersChange({ ...value, genres: selectedGenres.includes(genreId)
      ? selectedGenres.filter(id => id !== genreId) : [...selectedGenres, genreId] })
  }

  function clearFilters(): void {
    onFiltersChange({ search: '', releaseWindow: 'year', genres: [] })
  }

  const hasActiveFilters =
    search !== '' || releaseWindow !== 'year' || selectedGenres.length > 0

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
          onChange={(e) => onFiltersChange({ ...value, search: e.target.value })}
          aria-label="Search movie titles"
          className="type-input input pl-12 pr-4 py-3"
          data-testid="movie-search-input"
        />
        {loading && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
            <SpinnerIcon className="w-5 h-5 text-gold" />
          </div>
        )}
      </div>

      {disabledReason && <p id={descriptionId} className="type-body-sm text-foreground-secondary">{disabledReason}</p>}

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Release Window Dropdown */}
        <select
          value={releaseWindow}
          onChange={(e) => onFiltersChange({ ...value, releaseWindow: e.target.value as DraftFilters['releaseWindow'] })}
          aria-label="Release window"
          disabled={Boolean(disabledReason)}
          aria-describedby={disabledReason ? descriptionId : undefined}
          className="type-input bg-elevated border border-border rounded-lg px-4 py-2 text-foreground focus:border-gold focus:ring-1 focus:ring-gold outline-none cursor-pointer transition-all hover:border-border-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {RELEASE_WINDOWS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {/* Genre Multi-Select */}
        <div className="relative" ref={genreDropdownRef} onKeyDown={event => {
          if (event.key === 'Escape') {
            setShowGenreDropdown(false)
            genreDropdownRef.current?.querySelector('button')?.focus()
          }
        }}>
          <button
            onClick={() => setShowGenreDropdown(!showGenreDropdown)}
            disabled={Boolean(disabledReason)}
            aria-expanded={showGenreDropdown && !disabledReason}
            aria-controls={genreListId}
            aria-describedby={disabledReason ? descriptionId : undefined}
            className={cn(
              'type-control flex items-center gap-2 bg-elevated border rounded-lg px-4 py-2 transition-all hover:border-border-hover disabled:opacity-50 disabled:cursor-not-allowed',
              selectedGenres.length > 0 ? 'border-gold text-gold' : 'border-border text-foreground-secondary'
            )}
          >
            <span>{genreButtonLabel}</span>
            <ChevronDownIcon className={cn('w-4 h-4 transition-transform', showGenreDropdown && 'rotate-180')} />
          </button>

          {showGenreDropdown && !disabledReason && (
            <div id={genreListId} className="absolute top-full right-0 sm:left-0 sm:right-auto mt-2 w-64 max-h-72 overflow-y-auto bg-surface border border-border rounded-xl shadow-heavy z-50 animate-fade-in">
              <div className="p-2">
                {selectedGenres.length > 0 && (
                  <button
                    onClick={() => onFiltersChange({ ...value, genres: [] })}
                    className="type-control w-full px-3 py-2 text-left text-crimson hover:bg-elevated rounded-lg transition-colors mb-1"
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
                      aria-pressed={isSelected}
                      className={cn(
                        'type-control w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-all',
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

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="type-control flex items-center gap-1.5 text-foreground-secondary hover:text-crimson transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
            Clear filters
          </button>
        )}

        <div className="type-body-sm ml-auto text-foreground-secondary" role="status">
          {countLabel}
        </div>
      </div>

      {/* Active Genre Chips */}
      {selectedGenres.length > 0 && !disabledReason && (
        <div className="flex flex-wrap gap-2 animate-fade-in">
          {selectedGenres.map((genreId) => {
            const genre = TMDB_GENRES.find((g) => g.id === genreId)
            return (
              <button
                key={genreId}
                onClick={() => toggleGenre(genreId)}
                aria-label={`Remove ${genre?.name ?? 'genre'} filter`}
                className="type-control inline-flex items-center gap-1.5 px-3 py-1 bg-gold-muted border border-gold rounded-full text-gold hover:bg-gold hover:text-background transition-all group"
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
