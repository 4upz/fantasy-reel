import MoviePoster from '@/app/components/MoviePoster'
import { getReleaseYear } from '@/utils/date'
import type { TradeItems, TradeMovieItem } from '@/types'
import CounterpickMark from './CounterpickMark'

/** @design-system League */
export default function TradeItemsSection({
  title,
  items,
  isYours,
  contestedSourceIds,
  focus,
}: {
  title: string
  items: TradeItems
  isYours: boolean
  /** Empty unless this offer is still open and competing offers exist. */
  contestedSourceIds: ReadonlySet<string>
  focus?: string
}) {
  const hasItems = items.movies.length > 0 || items.faab > 0

  const content = (
    <>
      <p className="type-label text-foreground-secondary mb-2">{title}</p>

      {!hasItems ? (
        <p className="type-body-sm text-foreground-secondary italic">Nothing</p>
      ) : (
        <div className="space-y-2">
          {items.movies.map((movie: TradeMovieItem) => (
            <div key={movie.source_id} className="flex items-center gap-2">
              <div className="relative w-8 h-12 shrink-0 rounded bg-surface-hover">
                <MoviePoster
                  src={movie.poster_url}
                  alt={movie.title || 'Movie'}
                  sizes="32px"
                  posterSize="w92"
                  className="rounded"
                />
                {movie.source === 'counterpick' && <CounterpickMark />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="type-row-title text-foreground break-words">
                  {movie.title || 'Unknown Movie'}
                </p>
                {/* Without this the row is indistinguishable from the movie
                    itself -- same title, same poster, opposite meaning. */}
                {movie.source === 'counterpick' && (
                  <p className="type-meta text-crimson">Counterpick</p>
                )}
                {movie.release_date && (
                  <p className="type-meta text-foreground-secondary">
                    {getReleaseYear(movie.release_date)}
                  </p>
                )}
                {/* The card badge says the deal is contested; this says which
                    movie, which is the part that matters on a multi-movie offer. */}
                {contestedSourceIds.has(movie.source_id) && (
                  <p className="type-meta text-warning">Also in another trade</p>
                )}
              </div>
            </div>
          ))}

          {items.faab > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gold/20 rounded flex items-center justify-center">
                <span className="type-row-title text-gold">$</span>
              </div>
              <p className="type-number text-gold">${items.faab} budget</p>
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className={`p-3 rounded-lg ${isYours ? 'bg-crimson/10' : 'bg-success/10'}`}>
      {focus ? (
        <div data-preview-focus={focus} className="w-fit min-w-[190px] max-w-full">
          {content}
        </div>
      ) : content}
    </div>
  )
}
