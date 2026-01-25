'use client'

import { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import { Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import type { CounterpickOption } from '@/types'
import { SpinnerIcon, ClapperboardIcon } from './Icons'

interface Props {
  leagueId: string
  teamId: string
  isMyTurn: boolean
  isPicking: boolean
  onPick: (movieId: string, option: CounterpickOption) => Promise<void>
}

interface GroupedOptions {
  teamId: string
  teamName: string
  movies: CounterpickOption[]
}

export default function CounterpickPicker({
  leagueId,
  teamId,
  isMyTurn,
  isPicking,
  onPick,
}: Props) {
  const [options, setOptions] = useState<CounterpickOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedOption, setSelectedOption] = useState<CounterpickOption | null>(null)

  // Fetch counterpick options when component mounts or when turn changes
  useEffect(() => {
    async function fetchOptions() {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      const { data, error: fetchError } = await supabase.rpc('get_counterpick_options', {
        p_league_id: leagueId,
        p_team_id: teamId,
      })

      if (fetchError) {
        console.error('Error fetching counterpick options:', fetchError)
        setError('Failed to load counterpick options')
        setOptions([])
      } else {
        setOptions(data || [])
      }

      setLoading(false)
    }

    if (leagueId && teamId) {
      fetchOptions()
    }
  }, [leagueId, teamId])

  // Group options by opponent team
  const groupedOptions = useMemo<GroupedOptions[]>(() => {
    const groups = new Map<string, GroupedOptions>()

    for (const option of options) {
      const existing = groups.get(option.owner_team_id)
      if (existing) {
        existing.movies.push(option)
      } else {
        groups.set(option.owner_team_id, {
          teamId: option.owner_team_id,
          teamName: option.owner_team_name,
          movies: [option],
        })
      }
    }

    // Sort groups alphabetically by team name
    return Array.from(groups.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
    )
  }, [options])

  const handleSelectOption = (option: CounterpickOption) => {
    if (!isMyTurn || isPicking) return
    setSelectedOption(option)
  }

  const handleConfirmPick = async () => {
    if (!selectedOption || !isMyTurn || isPicking) return
    await onPick(selectedOption.movie_id, selectedOption)
    setSelectedOption(null)
  }

  const handleCancelSelection = () => {
    setSelectedOption(null)
  }

  // Loading state
  if (loading) {
    return (
      <div className="text-center py-12">
        <SpinnerIcon className="w-8 h-8 text-gold mx-auto animate-spin" />
        <p className="text-foreground-secondary mt-3">Loading opponent movies...</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="alert alert-error">
        {error}
      </div>
    )
  }

  // Empty state
  if (options.length === 0) {
    return (
      <div className="text-center py-12 bg-elevated rounded-xl border border-border">
        <div className="flex justify-center mb-3">
          <Target className="w-10 h-10 text-foreground-muted" />
        </div>
        <p className="text-foreground-secondary">No movies available to counterpick</p>
        <p className="text-sm text-foreground-muted mt-1">
          All opponent movies have already been counterpicked
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${selectedOption && isMyTurn ? 'pb-32 sm:pb-24' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-display font-semibold text-foreground">
          {isMyTurn ? 'Select Movie to Counterpick' : 'Opponent Movies'}
        </h3>
        {isMyTurn && (
          <span className="badge bg-success-bg text-success border border-success">
            Your Turn
          </span>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-elevated rounded-xl border border-border p-4">
        <div className="flex items-start gap-3">
          <Target className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-foreground-secondary text-sm">
              Bet against an opponent&apos;s movie. If it scores below 70, you earn points equal to their loss. If it scores above 70, you lose points equal to their gain.
            </p>
          </div>
        </div>
      </div>

      {/* Grouped movie cards */}
      <div className="space-y-6">
        {groupedOptions.map((group) => (
          <div key={group.teamId} className="space-y-3">
            {/* Team header */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gold/20 rounded-full flex items-center justify-center">
                <span className="text-gold text-xs font-semibold">
                  {group.teamName.charAt(0).toUpperCase()}
                </span>
              </div>
              <h4 className="text-sm font-medium text-foreground-secondary">
                {group.teamName}
              </h4>
              <span className="text-xs text-foreground-muted">
                ({group.movies.length} {group.movies.length === 1 ? 'movie' : 'movies'})
              </span>
            </div>

            {/* Movie cards grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {group.movies.map((option) => (
                <CounterpickMovieCard
                  key={option.draft_pick_id}
                  option={option}
                  isSelected={selectedOption?.draft_pick_id === option.draft_pick_id}
                  isSelectable={isMyTurn && !isPicking}
                  onSelect={handleSelectOption}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Selection Confirmation Overlay */}
      {selectedOption && isMyTurn && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface/95 backdrop-blur-md border-t border-border shadow-heavy z-40 animate-slide-up">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-4">
              {/* Selected movie preview */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {selectedOption.poster_url ? (
                  <div className="relative w-12 h-16 rounded-lg overflow-hidden border border-border">
                    <Image
                      src={selectedOption.poster_url}
                      alt={selectedOption.movie_title}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-12 h-16 bg-elevated rounded-lg border border-border flex items-center justify-center">
                    <ClapperboardIcon className="w-5 h-5 text-foreground-muted" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {selectedOption.movie_title}
                  </p>
                  <p className="text-sm text-foreground-muted">
                    Owned by {selectedOption.owner_team_name}
                  </p>
                  {selectedOption.release_date && (
                    <p className="text-xs text-foreground-muted">
                      {new Date(selectedOption.release_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Counterpick indicator */}
              <div className="flex items-center gap-2 px-3 py-2 bg-crimson/10 border border-crimson/30 rounded-lg">
                <Target className="w-4 h-4 text-crimson" />
                <span className="text-sm font-medium text-crimson">Counterpick</span>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleCancelSelection}
                  disabled={isPicking}
                  className="btn btn-ghost px-4"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPick}
                  disabled={isPicking}
                  className="btn btn-primary px-6"
                >
                  {isPicking ? (
                    <span className="flex items-center gap-2">
                      <SpinnerIcon className="w-4 h-4" />
                      Picking...
                    </span>
                  ) : (
                    'Confirm Counterpick'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface CounterpickMovieCardProps {
  option: CounterpickOption
  isSelected: boolean
  isSelectable: boolean
  onSelect: (option: CounterpickOption) => void
}

function CounterpickMovieCard({
  option,
  isSelected,
  isSelectable,
  onSelect,
}: CounterpickMovieCardProps) {
  const hasScore = option.fantasy_points !== null

  return (
    <button
      onClick={() => onSelect(option)}
      disabled={!isSelectable}
      title={!isSelectable ? "Wait for your turn to make a counterpick" : undefined}
      className={`relative group text-left rounded-xl overflow-hidden transition-all ${
        isSelected
          ? 'ring-2 ring-crimson shadow-glow-crimson scale-[1.02]'
          : isSelectable
          ? 'hover:ring-2 hover:ring-gold/50 hover:shadow-medium hover:scale-[1.01]'
          : 'opacity-60'
      } ${isSelectable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
    >
      {/* Poster */}
      <div className="aspect-[2/3] relative bg-elevated">
        {option.poster_url ? (
          <Image
            src={option.poster_url}
            alt={option.movie_title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ClapperboardIcon className="w-12 h-12 text-foreground-muted" />
          </div>
        )}

        {/* Hover overlay */}
        {isSelectable && (
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-crimson rounded-full">
              <Target className="w-3.5 h-3.5 text-white" />
              <span className="text-xs font-medium text-white">Counterpick</span>
            </div>
          </div>
        )}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-crimson rounded-full flex items-center justify-center shadow-lg">
            <Target className="w-3.5 h-3.5 text-white" />
          </div>
        )}

        {/* Score badge if available */}
        {hasScore && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-background/80 backdrop-blur-sm rounded text-xs font-medium">
            <span className={option.fantasy_points! >= 0 ? 'text-success' : 'text-crimson'}>
              {option.fantasy_points! >= 0 ? '+' : ''}{option.fantasy_points} pts
            </span>
          </div>
        )}
      </div>

      {/* Movie info */}
      <div className="p-3 bg-surface border-t border-border">
        <p className="font-medium text-foreground text-sm truncate">{option.movie_title}</p>
        {option.release_date && (
          <p className="text-xs text-foreground-muted mt-0.5">
            {new Date(option.release_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
      </div>
    </button>
  )
}
