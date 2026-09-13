import { fantasyPointsForTomatometer } from '@/utils/scoring'
import { RosterMovieCard } from '../../(authenticated)/league/[id]/roster/RosterPresentation'
import TeamStandingSummary from '../../(authenticated)/league/[id]/standings/TeamStandingSummary'
import styles from './landing.module.css'

// Fixed Rotten Tomatoes snapshot, checked September 13, 2026:
// https://www.rottentomatoes.com/m/barbie
const BARBIE_TOMATOMETER = 88
const BARBIE_POINTS = fantasyPointsForTomatometer(BARBIE_TOMATOMETER)

/** Fixed example data in the same display component as the league standings. */
export default function StandingsPreviewScene() {
  return (
    <div className={styles.scoringScene}>
      <div className={styles.scoringMovie}>
        <RosterMovieCard
          movie={{
            title: 'Barbie',
            poster_url: null,
            fantasy_points: BARBIE_POINTS,
            combined_score: BARBIE_TOMATOMETER,
          }}
          posterSrc="/images/homepage/barbie.webp"
          posterSizes="220px"
          label="Vintage Vibes · Round 1, Pick 1"
          isLocked={false}
          reviewFocus
        />
      </div>
      <div className={styles.scoringStandings}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="type-section text-foreground">Standings</h3>
          <span className="type-meta text-foreground-secondary">Example league</span>
        </div>
        <div className="space-y-3">
          <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
            <TeamStandingSummary
              rank={1}
              isTied={false}
              displayName="Classic Cinema"
              ownerHandle="Carol"
              isCurrentUser={false}
              movieCount={5}
              moviesScored={4}
              moviesPending={1}
              budgetLeft={72}
              totalPoints={122}
              inline
            />
          </div>
          <div className="rounded-[14px] border border-gold/35 bg-surface px-4 py-3.5" data-preview-focus="team">
            <TeamStandingSummary
              rank={2}
              isTied={false}
              displayName="Vintage Vibes"
              ownerHandle="Alice"
              isCurrentUser
              movieCount={5}
              moviesScored={4}
              moviesPending={1}
              budgetLeft={85}
              totalPoints={76 + BARBIE_POINTS}
              inline
            />
          </div>
        </div>
      </div>
    </div>
  )
}
