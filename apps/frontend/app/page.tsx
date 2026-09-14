import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ChevronDown } from 'lucide-react'
import MarketingHeader from './components/landing/MarketingHeader'
import HeroMovieLineup from './components/landing/HeroMovieLineup'
import SpotlightPreview from './components/landing/SpotlightPreview'
import DraftPreviewScene from './components/landing/DraftPreviewScene'
import RosterPreviewScene from './components/landing/RosterPreviewScene'
import MovesPreviewScene from './components/landing/MovesPreviewScene'
import SiteFooter from './components/landing/SiteFooter'
import ScrollDepth from './components/landing/ScrollDepth'
import styles from './components/landing/landing.module.css'

export const metadata: Metadata = {
  title: 'Fantasy Reel — Draft movies. Compete with friends.',
  description: 'Build a roster of upcoming movies, compete with friends, and earn fantasy points from critic scores.',
}

export default function LandingPage(): React.ReactElement {
  return (
    <ScrollDepth className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <a href="#main-content" className={styles.skipLink}>Skip to content</a>
      <MarketingHeader transparent />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title" data-hero>
          <div className={styles.heroCopy}>
            <p className={`type-meta ${styles.eyebrow}`}>Fantasy leagues for movie fans</p>
            <h1 id="hero-title" className={`type-hero ${styles.headline}`}>Draft movies.<br />Compete with friends.</h1>
            <p className={`type-lead ${styles.intro}`}>Build a roster of upcoming movies and earn fantasy points from their critic scores.</p>
            <div className={styles.heroActions}>
              <Link href="/signup" className="btn btn-primary">Start a league <ArrowRight size={16} className="ml-2" aria-hidden="true" /></Link>
              <a href="#how-it-works" className="btn btn-secondary">See how it works</a>
            </div>
            <HeroMovieLineup />
          </div>
          <a href="#how-it-works" className={styles.scrollCue} data-scroll-cue data-testid="hero-scroll-cue">
            <span className="type-control">How to play</span>
            <ChevronDown size={20} className={styles.scrollCueIcon} aria-hidden="true" />
          </a>
        </section>
        <div id="how-it-works" tabIndex={-1}>
          <section className={styles.section} aria-labelledby="draft-title" data-scroll-depth>
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
        </div>
        <section className={styles.section} aria-labelledby="season-title" data-scroll-depth>
          <div className={styles.sectionHeader}>
            <p className={`type-meta ${styles.sectionNumber}`}><span>02</span> FOLLOW THE SEASON</p>
            <h2 id="season-title" className={`type-page ${styles.sectionTitle}`}>The reviews are in.<br />So are the rivalries.</h2>
            <p className={`type-lead ${styles.sectionIntro}`}>As your movies arrive, their Rotten Tomatoes scores become fantasy points. Better reviews, more to brag about.</p>
          </div>
          <SpotlightPreview title="Roster and movie scores" width={1088} height={640} layout="beside" details={[
            { label: 'Your roster and budget', description: 'After the draft, you have a starting roster to follow all season and a Fantasy Budget to bid on more movies. There’s room to grow.' },
            { label: 'How your picks score', description: 'Each pick stays Pending until its Rotten Tomatoes critic score arrives. That score determines whether you earn or lose fantasy points.', focus: 'reviews' },
          ]}>
            <RosterPreviewScene />
          </SpotlightPreview>
          <p className={`type-body-sm ${styles.exampleNote}`}>Real 2023 movies and saved Rotten Tomatoes scores. The team and budget are fictional.</p>
        </section>
        <section className={styles.section} aria-labelledby="moves-title" data-scroll-depth>
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
        <section className={`${styles.section} ${styles.faq}`} aria-labelledby="questions-title" data-scroll-depth>
          <div className={styles.sectionHeader}><h2 id="questions-title" className={`type-page ${styles.sectionTitle}`}>Frequently asked questions</h2></div>
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
        <section className={styles.closing} aria-labelledby="closing-title" data-scroll-depth>
          <h2 id="closing-title" className={`type-page ${styles.sectionTitle}`}>Your group chat has opinions.<br />Give them a leaderboard.</h2>
          <p className="type-lead">Bring your friends. Pick your movies. Make it a season.</p>
          <div className={styles.heroActions}>
            <Link href="/signup" className="btn btn-primary">Start a league <ArrowRight size={16} className="ml-2" aria-hidden="true" /></Link>
            <Link href="/how-to-play" className="btn btn-secondary">How to play</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </ScrollDepth>
  )
}
