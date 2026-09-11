import type { Metadata } from 'next'
import HowToPlayContent from '@/app/components/HowToPlayContent'
import MarketingHeader from '@/app/components/landing/MarketingHeader'
import SiteFooter from '@/app/components/landing/SiteFooter'
import styles from '@/app/components/landing/landing.module.css'

export const metadata: Metadata = {
  title: 'How to Play | Fantasy Reel',
  description: 'Learn how to play Fantasy Reel - drafting, scoring, pickups, trading, and more.',
  alternates: { canonical: '/how-to-play' },
}

export default function HowToPlayPage(): React.ReactElement {
  return (
    <div className={`min-h-screen bg-background ${styles.page}`}>
      <a href="#main-content" className={styles.skipLink}>Skip to content</a>
      <MarketingHeader currentPage="how-to-play" />
      <main id="main-content" tabIndex={-1}>
        <HowToPlayContent publicView />
      </main>
      <SiteFooter />
    </div>
  )
}
