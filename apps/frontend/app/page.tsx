import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import MarketingHeader from './components/landing/MarketingHeader'
import SpotlightPreview from './components/landing/SpotlightPreview'
import RosterPreviewScene from './components/landing/RosterPreviewScene'
import DraftPreviewScene from './components/landing/DraftPreviewScene'
import StandingsPreviewScene from './components/landing/StandingsPreviewScene'
import MovesPreviewScene from './components/landing/MovesPreviewScene'
import SiteFooter from './components/landing/SiteFooter'
import styles from './components/landing/landing.module.css'

export const metadata: Metadata = {
  title: 'Fantasy Reel — Great taste deserves a trophy',
  description: 'Draft upcoming movies, compete with friends, and let the critics settle it. Your next fantasy league starts at the movies.',
}

export default function LandingPage(): React.ReactElement {
  return (
    <div className={styles.page}>
      <a href="#main-content" className={styles.skipLink}>Skip to content</a>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.ambient} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <p className={`type-meta ${styles.eyebrow}`}>FANTASY LEAGUES. FOR MOVIE PEOPLE.</p>
            <h1 id="hero-title" className={`type-hero ${styles.headline}`}>Great taste<br /><span>deserves a trophy.</span></h1>
            <p className={`type-lead ${styles.intro}`}>Draft upcoming movies. Compete with friends.<br className="hidden sm:block" /> Let the critics settle it.</p>
            <div className={styles.heroActions}>
              <Link href="/signup" className="btn btn-primary">Start a league <ArrowRight size={16} className="ml-2" aria-hidden="true" /></Link>
              <Link href="#your-roster" className="btn btn-secondary">Take a closer look</Link>
            </div>
          </div>
          <div id="your-roster" className={styles.heroPreview}>
            <SpotlightPreview title="Your roster" width={1088} height={618} details={[
              { label: 'The lineup', description: 'Your movies, your season. Keep your picks and their review status together in one roster.' },
              { label: 'Your budget', description: 'Keep an eye on your Fantasy Budget and remaining drops as you plan your next move.', focus: 'budget' },
              { label: 'Review status', description: 'A movie stays Pending until a Rotten Tomatoes score is available. Then the reviews turn into fantasy points.', focus: 'reviews' },
            ]}>
              <RosterPreviewScene />
            </SpotlightPreview>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="draft-title">
          <div className={styles.sectionHeader}>
            <p className={`type-meta ${styles.sectionNumber}`}><span>01</span> MAKE YOUR PICKS</p>
            <h2 id="draft-title" className={`type-page ${styles.sectionTitle}`}>Draft night.<br />Everyone’s a critic.</h2>
            <p className={`type-lead ${styles.sectionIntro}`}>Get your friends together and take turns picking the movies you believe in. That sleeper hit? It could be your season.</p>
          </div>
          <SpotlightPreview title="The draft room" width={760} height={352} layout="beside" details={[
            { label: 'The whole room, in sync', description: 'Follow the draft as picks come in. Everyone sees the board update in real time.' },
            { label: 'Know when you’re up', description: 'The current turn, round, and pick stay front and center.', focus: 'turn' },
            { label: 'Think a pick ahead', description: 'See who picks next. The snake draft reverses the order each round.', focus: 'queue' },
          ]}>
            <DraftPreviewScene />
          </SpotlightPreview>
        </section>
        <section className={styles.section} aria-labelledby="season-title">
          <div className={styles.sectionHeader}>
            <p className={`type-meta ${styles.sectionNumber}`}><span>02</span> FOLLOW THE SEASON</p>
            <h2 id="season-title" className={`type-page ${styles.sectionTitle}`}>The reviews are in.<br />So are the rivalries.</h2>
            <p className={`type-lead ${styles.sectionIntro}`}>As your movies arrive, their Rotten Tomatoes scores become fantasy points. Follow the standings and see whose taste holds up.</p>
          </div>
          <SpotlightPreview title="League standings" width={800} height={280} layout="beside" details={[
            { label: 'A little friendly competition', description: 'Your league’s teams, points, and remaining budgets, together on one leaderboard.' },
            { label: 'Let the critics call it', description: 'Rotten Tomatoes drives fantasy points. Higher scores reward your picks; counterpicks add another layer of strategy.', focus: 'score' },
            { label: 'Room for your next move', description: 'See the Fantasy Budget each team has left before making your next bid or trade.', focus: 'budget' },
          ]}>
            <StandingsPreviewScene />
          </SpotlightPreview>
        </section>
        <section className={styles.section} aria-labelledby="moves-title">
          <div className={styles.sectionHeader}>
            <p className={`type-meta ${styles.sectionNumber}`}><span>03</span> MAKE YOUR NEXT MOVE</p>
            <h2 id="moves-title" className={`type-page ${styles.sectionTitle}`}>The draft is just<br />the opening scene.</h2>
            <p className={`type-lead ${styles.sectionIntro}`}>Spotted a promising release? Make a bid. See a better fit on a friend’s roster? Send a trade offer. Keep shaping your team throughout the season.</p>
          </div>
          <SpotlightPreview title="Bids and trades" width={800} height={470} layout="beside" details={[
            { label: 'Stay in the running', description: 'Use your Fantasy Budget for pickups and negotiate with other teams as the season unfolds.' },
            { label: 'Back your next pick', description: 'Bid on an available movie with your Fantasy Budget. Compete for the pickup and follow its status before bids resolve.', focus: 'bid' },
            { label: 'Find a trade that fits', description: 'Offer movies, counterpicks, or Fantasy Budget in exchange for what your team needs. The other team can accept, reject, or counter.', focus: 'trade' },
          ]}>
            <MovesPreviewScene />
          </SpotlightPreview>
        </section>
        <section className={`${styles.section} ${styles.faq}`} aria-labelledby="questions-title">
          <div className={styles.sectionHeader}><h2 id="questions-title" className={`type-page ${styles.sectionTitle}`}>Before the opening credits.</h2></div>
          <details>
            <summary className="type-row-title">Do I need to know every movie?</summary>
            <p className="type-body">Just bring your taste. Explore upcoming releases, make your picks, and discover new movies along the way.</p>
          </details>
          <details>
            <summary className="type-row-title">What decides my score?</summary>
            <p className="type-body">Rotten Tomatoes critic scores drive fantasy points. A movie without a score stays Pending. The full guide explains the scoring curve and how counterpicks work.</p>
          </details>
          <details>
            <summary className="type-row-title">Can I change my roster?</summary>
            <p className="type-body">Yes. Use bids, trades, and eligible drops to adjust your team within your league’s budget, roster limits, and deadlines.</p>
          </details>
          <Link href="/how-to-play" className={`type-control ${styles.guideLink}`}>Read the full How to Play guide <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>
        <section className={styles.closing} aria-labelledby="closing-title">
          <h2 id="closing-title" className={`type-page ${styles.sectionTitle}`}>Your group chat has opinions.<br />Give them a leaderboard.</h2>
          <p className="type-lead">Bring your friends. Pick your movies. Make it a season.</p>
          <div className={styles.heroActions}>
            <Link href="/signup" className="btn btn-primary">Start a league <ArrowRight size={16} className="ml-2" aria-hidden="true" /></Link>
            <Link href="/how-to-play" className="btn btn-secondary">How to play</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
