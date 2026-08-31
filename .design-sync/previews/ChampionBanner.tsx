import { ChampionBanner } from 'fantasy-reel'

const aces = { teamId: 't1', teamName: 'Academy Aces', ownerName: 'Carol Coppola' }
const hunters = { teamId: 't2', teamName: 'Award Hunters', ownerName: 'Bob Nolan' }

/** One winner: the season's result, and the only gradient on the page. */
export const Default = () => (
  <div className="max-w-2xl">
    <ChampionBanner seasonYear={2026} champions={[aces]} points={345} />
  </div>
)

/**
 * A tie. The plural eyebrow and the caption are load-bearing — without them,
 * two gold "T1" chips in the standings below read as a rendering bug.
 */
export const CoChampions = () => (
  <div className="max-w-2xl">
    <ChampionBanner seasonYear={2026} champions={[aces, hunters]} points={345} />
  </div>
)

/** The owner's rollover CTA rides in the banner as its trailing action. */
export const WithAction = () => (
  <div className="max-w-2xl">
    <ChampionBanner
      seasonYear={2026}
      champions={[aces]}
      points={345}
      action={<button className="btn btn-primary">Start the 2027 season</button>}
    />
  </div>
)

/** A champion who has since left the league keeps their title, without a name. */
export const TeamRemoved = () => (
  <div className="max-w-2xl">
    <ChampionBanner
      seasonYear={2025}
      champions={[{ teamId: 't9', teamName: null, ownerName: null }]}
      points={288}
    />
  </div>
)
