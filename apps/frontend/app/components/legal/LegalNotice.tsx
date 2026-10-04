import Link from 'next/link'

interface Props {
  /** What the person is doing, completing "By …, you agree", e.g. "creating an account". */
  action: string
}

const LINK_CLASS = 'text-gold underline underline-offset-2 transition-colors hover:text-gold-hover'

/**
 * The agreement statement shown beside every way to create an account, which
 * is how people accept the Terms of service. Links open in a new tab so a
 * half-filled form survives reading them.
 */
export default function LegalNotice({ action }: Props): React.ReactElement {
  return (
    <p className="type-body-sm text-center text-foreground-secondary" data-testid="legal-notice">
      By {action}, you agree to the{' '}
      <Link href="/terms" target="_blank" className={LINK_CLASS}>
        Terms of Service<span className="sr-only"> (opens in a new tab)</span>
      </Link>{' '}
      and acknowledge the{' '}
      <Link href="/privacy" target="_blank" className={LINK_CLASS}>
        Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
      </Link>
      .
    </p>
  )
}
