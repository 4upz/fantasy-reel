'use client'

import { useState, useEffect, useRef } from 'react'

interface Props {
  onSearch: (query: string) => void
  loading: boolean
}

export default function MovieSearchBar({ onSearch, loading }: Props) {
  const [value, setValue] = useState('')
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      onSearch(value)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [value, onSearch])

  const handleClear = () => {
    setValue('')
    onSearch('')
  }

  return (
    <div className="relative group">
      {/* Search icon */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
        <svg
          className="w-5 h-5 text-foreground-muted group-focus-within:text-gold transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      {/* Input field */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search for movies..."
        className="w-full pl-12 pr-12 py-4 text-lg bg-elevated border border-border rounded-xl text-foreground placeholder:text-foreground-muted focus:border-gold focus:ring-2 focus:ring-gold-muted focus:outline-none transition-all"
      />

      {/* Loading spinner or clear button */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        {loading && (
          <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        )}
        {!loading && value && (
          <button
            onClick={handleClear}
            className="p-1 text-foreground-muted hover:text-foreground transition-colors rounded-full hover:bg-surface-hover"
            aria-label="Clear search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Subtle glow effect on focus */}
      <div className="absolute inset-0 rounded-xl bg-gold/0 group-focus-within:bg-gold/5 transition-colors pointer-events-none" />
    </div>
  )
}
