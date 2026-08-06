import { DraftTicker } from 'fantasy-reel'
import { POSTERS } from './_fixtures'

// Handles and comment style follow the repo's own FICTIONAL_USERS and
// SNARKY_COMMENTS in apps/frontend/app/components/landing/data.ts.
const entries = [
  {
    user: { handle: '@AlwaysPicksA24', style: 'arthouse' as const },
    movie: { title: 'Dune: Part Two', posterUrl: POSTERS.dune },
    action: 'drafted' as const,
    comment: 'peak cinema',
  },
  {
    user: { handle: '@NobodyAskedMe', style: 'questionable' as const },
    movie: { title: 'The Garfield Movie', posterUrl: POSTERS.garfield },
    action: 'snagged' as const,
    comment: 'bold strategy',
  },
  {
    user: { handle: '@BlockbusterBro', style: 'mainstream' as const },
    movie: { title: 'Godzilla x Kong: The New Empire', posterUrl: POSTERS.godzilla },
    action: 'grabbed' as const,
    comment: 'called it',
  },
  {
    user: { handle: '@ScreamQueen', style: 'horror' as const },
    movie: { title: 'A Quiet Place: Day One', posterUrl: POSTERS.quietPlace },
    action: 'picked' as const,
    comment: 'sleeper alert',
  },
]

/**
 * A marquee of recent draft activity used as social proof on the marketing
 * page. It scrolls continuously — the entry list is duplicated internally for
 * a seamless loop, so a still frame catches it mid-travel.
 */
export const Default = () => <DraftTicker entries={entries} />

// Only one cell: the track duplicates its entries and scrolls, so a shorter
// list produces a visually identical still frame.
