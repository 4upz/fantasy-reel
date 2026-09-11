import { RosterPoster } from 'fantasy-reel'
import { POSTERS } from './_fixtures'

export const Default = () => (
  <div className="relative w-32 h-48 rounded-lg overflow-hidden bg-elevated">
    <RosterPoster movie={{ title: 'Dune: Part Two', poster_url: POSTERS.dune }} sizes="128px" />
  </div>
)

export const MissingArtwork = () => (
  <div className="relative w-32 h-48 rounded-lg overflow-hidden bg-elevated">
    <RosterPoster movie={{ title: 'Upcoming release', poster_url: null }} />
  </div>
)
