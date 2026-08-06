import { MovieGridSkeleton } from 'fantasy-reel'

/** The first-paint state of the movie catalogue. Defaults to 12 tiles. */
export const Default = () => <MovieGridSkeleton count={6} />

/** Size the placeholder to the page you are filling. */
export const ShortList = () => <MovieGridSkeleton count={3} />
