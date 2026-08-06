import { MovieCardSkeleton } from 'fantasy-reel'

/** Matches the MovieCard footprint exactly so the grid does not reflow on load. */
export const Default = () => (
  <div className="w-52">
    <MovieCardSkeleton />
  </div>
)

/** `index` staggers the fade-in so a row of skeletons cascades rather than
    appearing all at once. */
export const Staggered = () => (
  <div className="grid grid-cols-3 gap-4">
    <MovieCardSkeleton index={0} />
    <MovieCardSkeleton index={1} />
    <MovieCardSkeleton index={2} />
  </div>
)
