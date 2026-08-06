import { HeroSection } from 'fantasy-reel'
import { POSTERS } from './_fixtures'

const tickerEntries = [
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
]

/**
 * The marketing hero: full-viewport gradient with film grain, the NavLogo and
 * auth links pinned to the corners, headline, CTA, and the DraftTicker running
 * along the bottom. It sizes itself to `min-h-screen`, so give it a tall frame.
 */
export const Default = () => <HeroSection tickerEntries={tickerEntries} />
