'use client'

import { useId, useState } from 'react'
import Image from 'next/image'
import { ChevronDown, Film } from 'lucide-react'
import type { FranchiseHistory } from '@/types'
import { entryLabel } from '@/utils/franchise'
import { getReleaseYear } from '@/utils/date'
import TomatometerScore from './TomatometerScore'

interface Props {
  history: FranchiseHistory
  /** Open the film-by-film list on first render. */
  defaultOpen?: boolean
  className?: string
}

/**
 * The compact read on a movie's franchise, for rows that have no room for a
 * chart: bid pickers, trade cards. Words plus two pills -- the series average
 * and the most recent film -- and a disclosure that opens the score-by-score
 * list in place. The last film gets its own pill because it is usually the
 * better predictor of the next one than the average is.
 */
export default function FranchiseSummary({ history, defaultOpen = false, className = '' }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const listId = useId()

  return (
    <div className={className} data-testid="franchise-summary">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-secondary">
          <span>{entryLabel(history)} · series avg</span>
          <TomatometerScore score={history.average_rt} size="sm" showAccolade={false} />
          <span>· last one</span>
          <TomatometerScore score={history.last_rt} size="sm" showAccolade={false} />
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
          className="inline-flex items-center gap-1 -my-1 -mr-2 px-2 py-1 rounded-md text-xs font-medium text-gold hover:text-gold-hover hover:bg-gold-muted transition-colors"
        >
          {open ? 'Hide history' : 'Franchise history'}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <ul id={listId} className="mt-2.5 pt-2.5 border-t border-border space-y-1.5 animate-fade-in">
          {history.films.map((film) => (
            <li key={film.tmdb_id} className="flex items-center gap-2">
              <div className="relative w-5 h-[30px] shrink-0 rounded-[3px] overflow-hidden bg-elevated border border-border">
                {film.poster_url ? (
                  <Image src={film.poster_url} alt="" fill sizes="20px" className="object-cover" />
                ) : (
                  <Film className="w-3 h-3 m-auto mt-2 text-foreground-muted" />
                )}
              </div>
              <span className="flex-1 min-w-0 truncate text-xs text-foreground">
                {film.title}
                {film.release_date && (
                  <span className="text-foreground-muted"> {getReleaseYear(film.release_date)}</span>
                )}
              </span>
              <TomatometerScore score={film.rt_score} size="sm" showAccolade={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
