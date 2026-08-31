'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Clapperboard, X } from 'lucide-react'

interface Props {
  leagueId: string
  seasonYear: number
  /** The team carried over, named so the roster's emptiness reads as expected. */
  teamName: string | null
  /** The season that just ended, for the "final standings" link. */
  previousSeason: { id: string; seasonYear: number } | null
}

const STORAGE_PREFIX = 'fr:season-welcome-dismissed:'

/**
 * The first thing a member sees in a season they were carried into.
 *
 * Without it the biggest confusion risk in the whole feature lands
 * unexplained: they follow a notification to a league with no movies in it and
 * read "where did my roster go?" This says the roster is *supposed* to be
 * empty before they can misread it.
 *
 * Dismissal is per league id in `localStorage` - a preference this local is not
 * worth a table, and it correctly reappears for the next season's card.
 */
export default function SeasonWelcomeCard({
  leagueId,
  seasonYear,
  teamName,
  previousSeason,
}: Props): React.ReactElement | null {
  // Starts hidden and is revealed after the storage read, so the server render
  // and the first client render agree.
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    try {
      setIsVisible(window.localStorage.getItem(`${STORAGE_PREFIX}${leagueId}`) !== '1')
    } catch {
      setIsVisible(true)
    }
  }, [leagueId])

  function dismiss(): void {
    setIsVisible(false)
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${leagueId}`, '1')
    } catch {
      /* a browser that refuses storage just gets the card again next visit */
    }
  }

  if (!isVisible) return null

  return (
    <section className="card animate-slide-up flex items-start gap-3 p-5" data-testid="season-welcome">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gold-muted">
        <Clapperboard className="h-5 w-5 text-gold" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="font-display text-base font-semibold text-foreground">
          The {seasonYear} season is open
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          {teamName ? `Your team, ${teamName}, carried over.` : 'Your team carried over.'} Rosters
          start empty — the draft hasn&apos;t been scheduled yet.
        </p>
        {previousSeason && (
          <Link
            href={`/league/${previousSeason.id}/standings`}
            className="mt-2 inline-block text-sm text-gold transition-colors hover:text-gold-hover"
          >
            See the {previousSeason.seasonYear} final standings →
          </Link>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-none cursor-pointer p-1 text-foreground-muted transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </section>
  )
}
