import { useState, type ComponentProps } from 'react'
import { MovieScoreCard } from 'fantasy-reel'
import { fantasyPointsForTomatometer } from '../../apps/frontend/utils/scoring'
import { movie, POSTERS, daysOut } from './_fixtures'

type Movie = ComponentProps<typeof MovieScoreCard>['movie']

const scoredMovie = (): Movie => ({
  ...movie({ release_date: daysOut(-30) }),
  id: 'preview-dune',
  status: 'released',
  combined_score: 92,
  fantasy_points: fantasyPointsForTomatometer(92),
})

export const Default = () => {
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null)

  return (
    <div className="max-w-md space-y-2">
      <MovieScoreCard
        movie={scoredMovie()}
        badge={{ type: 'draft', round: 1, pick: 2 }}
        onSelect={(selected) => setSelectedTitle(selected.title)}
      />
      <p className="type-body-sm text-foreground-secondary" role="status">
        {selectedTitle ? `Selected ${selectedTitle}.` : 'Select the row to see its selection callback.'}
      </p>
    </div>
  )
}

export const AwaitingReviews = () => (
  <div className="max-w-md flex flex-col gap-3">
    <MovieScoreCard
      movie={{ ...scoredMovie(), poster_url: null, combined_score: null, fantasy_points: null }}
      badge={{ type: 'pickup', amount: 12 }}
    />
    <MovieScoreCard
      movie={{ ...scoredMovie(), status: 'upcoming', release_date: daysOut(20), combined_score: null, fantasy_points: null }}
      badge={{ type: 'draft', round: 2, pick: 3 }}
    />
  </div>
)

export const Counterpick = () => {
  const points = fantasyPointsForTomatometer(35)

  return (
    <div className="max-w-md">
      <MovieScoreCard
        movie={{ ...scoredMovie(), id: 'preview-garfield', tmdb_id: 748783, title: 'The Garfield Movie', poster_url: POSTERS.garfield, combined_score: 35, fantasy_points: points }}
        badge={{ type: 'counterpick', targetTeam: 'The Spielbergs' }}
        overridePoints={-points}
      />
    </div>
  )
}

export const CounterpickedByOpponent = () => (
  <div className="max-w-md">
    <MovieScoreCard movie={scoredMovie()} badge={{ type: 'draft', round: 1, pick: 2 }} isCounterpicked />
  </div>
)
