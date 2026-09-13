import { Trophy } from 'lucide-react'
import { fantasyPointsForTomatometer } from '@/utils/scoring'
import { RosterHeader, RosterMovieCard } from '../../(authenticated)/league/[id]/roster/RosterPresentation'

// Fixed Tomatometer snapshots from Rotten Tomatoes, checked September 13, 2026.
const MOVIES = [
  // https://www.rottentomatoes.com/m/barbie
  { title: 'Barbie', poster: 'barbie', label: 'Round 1, Pick 1', tomatometer: 88 },
  // https://www.rottentomatoes.com/m/killers_of_the_flower_moon
  { title: 'Killers of the Flower Moon', poster: 'killers', label: 'Round 2, Pick 4', tomatometer: 93 },
  // https://www.rottentomatoes.com/m/the_hunger_games_the_ballad_of_songbirds_and_snakes
  { title: 'The Hunger Games: The Ballad of Songbirds & Snakes', poster: 'ballad', label: 'Round 3, Pick 1', tomatometer: 64 },
  // https://www.rottentomatoes.com/m/the_marvels
  { title: 'The Marvels', poster: 'marvels', label: 'Round 4, Pick 4', tomatometer: 63 },
] as const

/** A fixed example, rendered with the roster's own presentation components. */
export default function RosterPreviewScene() {
  return (
    <div className="space-y-6 text-left" style={{ width: 1088, height: 640 }}>
      <RosterHeader
        teamName="Vintage Vibes"
        slotsFilled={4}
        totalSlots={8}
        remainingBudget={100}
        dropCount={0}
        dropLimit={3}
      />
      <div>
        <h2 className="type-section text-foreground flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-gold" aria-hidden="true" />
          Draft Picks (4)
        </h2>
        <div className="grid grid-cols-4 gap-4">
          {MOVIES.map((movie, index) => (
            <RosterMovieCard
              key={movie.poster}
              movie={{
                title: movie.title,
                poster_url: null,
                fantasy_points: fantasyPointsForTomatometer(movie.tomatometer),
                combined_score: movie.tomatometer,
              }}
              posterSrc={`/images/homepage/${movie.poster}.webp`}
              posterSizes="260px"
              label={movie.label}
              isLocked={false}
              reviewFocus={index === 0}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
