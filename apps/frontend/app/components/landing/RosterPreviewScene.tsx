import { Trophy } from 'lucide-react'
import { RosterHeader, RosterMovieCard } from '../../(authenticated)/league/[id]/roster/RosterPresentation'

const MOVIES = [
  { title: 'Barbie', poster: 'barbie', label: 'Round 1, Pick 1' },
  { title: 'Killers of the Flower Moon', poster: 'killers', label: 'Round 2, Pick 4' },
  { title: 'The Hunger Games: The Ballad of Songbirds & Snakes', poster: 'ballad', label: 'Round 3, Pick 1' },
  { title: 'The Marvels', poster: 'marvels', label: 'Round 4, Pick 4' },
] as const

/** A fixed example, rendered with the roster's own presentation components. */
export default function RosterPreviewScene() {
  return (
    <div className="space-y-6 text-left" style={{ width: 1088, height: 618 }}>
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
              movie={{ title: movie.title, poster_url: null, fantasy_points: null, combined_score: null }}
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
