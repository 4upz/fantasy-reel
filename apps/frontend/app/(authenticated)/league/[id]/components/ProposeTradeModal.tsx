'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import type { Team, TradeItems, TradeableMovie, TeamBudget, TradeMovieItem } from '@/types'
import { createClient } from '@/utils/supabase/client'

interface Props {
  team: Team
  otherTeams: { id: string; name: string; avatar_url: string | null }[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  onClose: () => void
  onPropose: (
    recipientTeamId: string,
    offeredItems: TradeItems,
    requestedItems: TradeItems,
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
}

export default function ProposeTradeModal({
  team,
  otherTeams,
  tradeableMovies,
  budget,
  onClose,
  onPropose,
}: Props) {
  const [step, setStep] = useState<'select-team' | 'select-items'>('select-team')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [recipientMovies, setRecipientMovies] = useState<TradeableMovie[]>([])
  const [recipientBudget, setRecipientBudget] = useState<TeamBudget | null>(null)

  // Selected items
  const [offeredMovies, setOfferedMovies] = useState<Set<string>>(new Set())
  const [offeredFaab, setOfferedFaab] = useState(0)
  const [requestedMovies, setRequestedMovies] = useState<Set<string>>(new Set())
  const [requestedFaab, setRequestedFaab] = useState(0)
  const [message, setMessage] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  // Fetch recipient's tradeable movies when team is selected
  useEffect(() => {
    if (!selectedTeamId) return

    const fetchRecipientMovies = async () => {
      try {
        // Fetch draft picks
        const { data: draftPicks } = await supabase
          .from('draft_picks')
          .select('id, movie_id, movies(id, title, poster_url, release_date, combined_score)')
          .eq('team_id', selectedTeamId)
          .is('dropped_at', null)

        // Fetch pickups
        const { data: pickups } = await supabase
          .from('pickups')
          .select('id, movie_id, movies(id, title, poster_url, release_date, combined_score)')
          .eq('team_id', selectedTeamId)
          .is('dropped_at', null)

        const movies: TradeableMovie[] = []

        if (draftPicks) {
          for (const pick of draftPicks) {
            const movie = pick.movies as {
              id: string
              title: string
              poster_url: string | null
              release_date: string | null
              combined_score: number | null
            } | null
            if (movie) {
              movies.push({
                movie_id: movie.id,
                source: 'draft_pick',
                source_id: pick.id,
                title: movie.title,
                poster_url: movie.poster_url,
                release_date: movie.release_date,
                combined_score: movie.combined_score,
              })
            }
          }
        }

        if (pickups) {
          for (const pickup of pickups) {
            const movie = pickup.movies as {
              id: string
              title: string
              poster_url: string | null
              release_date: string | null
              combined_score: number | null
            } | null
            if (movie) {
              movies.push({
                movie_id: movie.id,
                source: 'pickup',
                source_id: pickup.id,
                title: movie.title,
                poster_url: movie.poster_url,
                release_date: movie.release_date,
                combined_score: movie.combined_score,
              })
            }
          }
        }

        setRecipientMovies(movies)

        // Fetch recipient budget
        const { data: budgetData } = await supabase
          .from('team_budgets')
          .select('*')
          .eq('team_id', selectedTeamId)
          .single()

        setRecipientBudget(budgetData)
      } catch (err) {
        console.error('Error fetching recipient movies:', err)
      }
    }

    fetchRecipientMovies()
  }, [selectedTeamId, supabase])

  const selectedTeam = otherTeams.find((t) => t.id === selectedTeamId)

  const handleSelectTeam = (teamId: string) => {
    setSelectedTeamId(teamId)
    setStep('select-items')
  }

  const toggleOfferedMovie = (sourceId: string) => {
    setOfferedMovies((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  const toggleRequestedMovie = (sourceId: string) => {
    setRequestedMovies((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  const hasItems =
    offeredMovies.size > 0 ||
    offeredFaab > 0 ||
    requestedMovies.size > 0 ||
    requestedFaab > 0

  const handleSubmit = async () => {
    if (!selectedTeamId) return

    setIsLoading(true)
    setError(null)

    const offeredItems: TradeItems = {
      movies: tradeableMovies
        .filter((m) => offeredMovies.has(m.source_id))
        .map((m): TradeMovieItem => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: offeredFaab,
    }

    const requestedItems: TradeItems = {
      movies: recipientMovies
        .filter((m) => requestedMovies.has(m.source_id))
        .map((m): TradeMovieItem => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: requestedFaab,
    }

    const result = await onPropose(
      selectedTeamId,
      offeredItems,
      requestedItems,
      message.trim() || undefined
    )

    setIsLoading(false)

    if (!result.success) {
      setError(result.error || 'Failed to propose trade')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-foreground">
            {step === 'select-team' ? 'Select Trade Partner' : `Trade with ${selectedTeam?.name}`}
          </h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'select-team' ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground-secondary mb-4">
                Choose a team to trade with:
              </p>
              {otherTeams.map((otherTeam) => (
                <button
                  key={otherTeam.id}
                  onClick={() => handleSelectTeam(otherTeam.id)}
                  className="w-full card-interactive p-4 flex items-center gap-3 text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center overflow-hidden">
                    {otherTeam.avatar_url ? (
                      <Image
                        src={otherTeam.avatar_url}
                        alt={otherTeam.name}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-medium text-foreground-muted">
                        {otherTeam.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span className="font-medium text-foreground">{otherTeam.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Back button */}
              <button
                onClick={() => {
                  setStep('select-team')
                  setSelectedTeamId(null)
                  setOfferedMovies(new Set())
                  setOfferedFaab(0)
                  setRequestedMovies(new Set())
                  setRequestedFaab(0)
                }}
                className="text-sm text-gold hover:text-gold-hover transition-colors"
              >
                ← Change trade partner
              </button>

              {/* Your side */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  You give ({team.name})
                </h3>
                <MovieSelector
                  movies={tradeableMovies}
                  selectedIds={offeredMovies}
                  onToggle={toggleOfferedMovie}
                />
                <div className="mt-3">
                  <label className="text-sm text-foreground-secondary">
                    FAAB (max ${budget?.remaining_budget ?? 0})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={budget?.remaining_budget ?? 0}
                    value={offeredFaab}
                    onChange={(e) => setOfferedFaab(Math.max(0, parseInt(e.target.value) || 0))}
                    className="input mt-1 w-24"
                  />
                </div>
              </div>

              {/* Their side */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  You receive ({selectedTeam?.name})
                </h3>
                {recipientMovies.length === 0 && !recipientBudget ? (
                  <p className="text-sm text-foreground-muted">Loading...</p>
                ) : (
                  <>
                    <MovieSelector
                      movies={recipientMovies}
                      selectedIds={requestedMovies}
                      onToggle={toggleRequestedMovie}
                    />
                    <div className="mt-3">
                      <label className="text-sm text-foreground-secondary">
                        FAAB (max ${recipientBudget?.remaining_budget ?? 0})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={recipientBudget?.remaining_budget ?? 0}
                        value={requestedFaab}
                        onChange={(e) =>
                          setRequestedFaab(Math.max(0, parseInt(e.target.value) || 0))
                        }
                        className="input mt-1 w-24"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Message */}
              <div>
                <label className="text-sm text-foreground-secondary">
                  Message (optional)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input mt-1 w-full h-20 resize-none"
                  placeholder="Add a note to your trade proposal..."
                />
              </div>

              {error && (
                <div className="alert alert-error">
                  <p>{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'select-items' && (
          <div className="p-4 border-t border-border flex justify-end gap-2">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!hasItems || isLoading}
              className="btn btn-primary"
            >
              {isLoading ? 'Proposing...' : 'Propose Trade'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MovieSelector({
  movies,
  selectedIds,
  onToggle,
}: {
  movies: TradeableMovie[]
  selectedIds: Set<string>
  onToggle: (sourceId: string) => void
}) {
  if (movies.length === 0) {
    return <p className="text-sm text-foreground-muted italic">No movies available</p>
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {movies.map((movie) => {
        const isSelected = selectedIds.has(movie.source_id)
        return (
          <button
            key={movie.source_id}
            onClick={() => onToggle(movie.source_id)}
            className={`w-full p-2 rounded-lg flex items-center gap-3 text-left transition-colors ${
              isSelected
                ? 'bg-gold/20 border border-gold'
                : 'bg-surface-hover hover:bg-elevated border border-transparent'
            }`}
          >
            {movie.poster_url ? (
              <Image
                src={movie.poster_url}
                alt={movie.title}
                width={32}
                height={48}
                className="w-8 h-12 object-cover rounded"
              />
            ) : (
              <div className="w-8 h-12 bg-surface rounded flex items-center justify-center">
                <span className="text-xs text-foreground-muted">?</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{movie.title}</p>
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                {movie.release_date && (
                  <span>{new Date(movie.release_date).getFullYear()}</span>
                )}
                {movie.combined_score !== null && (
                  <span className="text-gold">{movie.combined_score.toFixed(0)} pts</span>
                )}
              </div>
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                isSelected ? 'border-gold bg-gold' : 'border-border'
              }`}
            >
              {isSelected && (
                <svg className="w-3 h-3 text-background" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
