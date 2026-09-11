import { TradeItemsSection } from 'fantasy-reel'
import { POSTERS, daysOut } from './_fixtures'

const movie = {
  movie_id: 'movie-dune',
  source: 'draft_pick' as const,
  source_id: 'pick-dune',
  title: 'Dune: Part Two',
  poster_url: POSTERS.dune,
  release_date: daysOut(20),
}

export const Default = () => (
  <div className="max-w-sm">
    <TradeItemsSection
      title="You receive"
      items={{ movies: [movie], faab: 15 }}
      isYours={false}
      contestedSourceIds={new Set()}
    />
  </div>
)

export const ContestedCounterpick = () => (
  <div className="max-w-sm">
    <TradeItemsSection
      title="You send"
      items={{ movies: [{ ...movie, source: 'counterpick', source_id: 'counterpick-dune' }], faab: 0 }}
      isYours
      contestedSourceIds={new Set(['counterpick-dune'])}
    />
  </div>
)
