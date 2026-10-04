import { ExternalLink as ExternalLinkIcon } from 'lucide-react'
import MarketingHeader from '../landing/MarketingHeader'
import SiteFooter from '../landing/SiteFooter'
import landingStyles from '../landing/landing.module.css'
import styles from './LegalPage.module.css'

const SUPPORT_EMAIL = 'support@fantasyreel.com'

export function SupportEmailLink(): React.ReactElement {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
}

/** A link to another site, opened in a new tab and announced as such. */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLinkIcon className={styles.externalIcon} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export interface LegalSection {
  id: string
  title: string
  content: React.ReactNode
}

interface Props {
  title: string
  /** Calendar date the document takes effect, e.g. '2026-10-03'. */
  effectiveDate: string
  intro: React.ReactNode
  /** Drives both the headings and the table of contents. */
  sections: LegalSection[]
}

// A bare ISO date parses as UTC midnight, so format it in UTC to keep the day.
const EFFECTIVE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })

/** The page shared by the policy documents: marketing shell, title, contents and body. */
export default function LegalPage({ title, effectiveDate, intro, sections }: Props): React.ReactElement {
  return (
    <div className={`min-h-screen bg-background ${landingStyles.page}`}>
      <a href="#main-content" className={landingStyles.skipLink}>Skip to content</a>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${styles.layout}`}>
          <header className={styles.header}>
            <h1 className="type-page text-foreground">{title}</h1>
            <p className="type-body-sm mt-3 text-foreground-secondary">
              Effective date:{' '}
              <time dateTime={effectiveDate}>{EFFECTIVE_DATE_FORMAT.format(new Date(effectiveDate))}</time>
            </p>
          </header>

          <nav className={`card ${styles.toc}`} aria-labelledby="legal-toc-label" data-testid="legal-toc">
            <p id="legal-toc-label" className="type-label text-foreground">On this page</p>
            <ol className={styles.tocList}>
              {sections.map(({ id, title }) => (
                <li key={id}>
                  <a href={`#${id}`} className="type-body-sm">{title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={`type-body ${styles.document}`}>
            {intro}
            {sections.map(({ id, title, content }) => (
              <section key={id} id={id} className={styles.section}>
                <h2 className="type-section text-foreground">{title}</h2>
                {content}
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
