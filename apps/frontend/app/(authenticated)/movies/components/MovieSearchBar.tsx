'use client'

import { useRef } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  loading: boolean
  compact?: boolean
}

/**
 * Pure controlled movie search input.
 * All debouncing and search logic is handled by the parent component.
 * The full-size bar is the page's search landmark; the compact floating copy
 * is a convenience duplicate and stays out of landmark navigation.
 * @design-system Movies
 */
export default function MovieSearchBar({
  value,
  onChange,
  onClear,
  loading,
  compact = false,
}: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleClear(): void {
    onClear()
    // The clear button unmounts once the field is empty; keep focus in the field.
    inputRef.current?.focus()
  }

  const field = (
    <div className="relative group">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
        <svg
          className="w-5 h-5 text-foreground-muted group-focus-within:text-gold transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      <input
        ref={inputRef}
        type="search"
        aria-label="Search movies"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search for movies..."
        className={`input w-full appearance-none pl-12 pr-12 rounded-xl [&::-webkit-search-cancel-button]:appearance-none ${compact ? 'py-2.5' : 'py-4'}`}
      />

      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        {loading && (
          <div aria-hidden="true" className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        )}
        {!loading && value && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1 text-foreground-secondary hover:text-foreground transition-colors rounded-full hover:bg-surface-hover"
            aria-label="Clear search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {!compact && (
        <div className="absolute inset-0 rounded-xl bg-gold/0 group-focus-within:bg-gold/5 transition-colors pointer-events-none" />
      )}
    </div>
  )

  if (compact) return field

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()}>
      {field}
    </form>
  )
}
