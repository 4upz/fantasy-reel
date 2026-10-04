interface Props {
  /** What the person is doing, completing "By …, you agree", e.g. "creating an account". */
  action: string
}

const LINK_CLASS = 'whitespace-nowrap text-gold underline underline-offset-2 transition-colors hover:text-gold-hover'

/**
 * The agreement statement shown beside every way to create an account, which
 * is how people accept the Terms of service. Links open in a new tab so a
 * half-filled form survives reading them; plain anchors, because a new tab
 * never uses the client router and next/link would prefetch for nothing.
 */
export default function LegalNotice({ action }: Props): React.ReactElement {
  return (
    <p className="type-body-sm text-center text-balance text-foreground-secondary" data-testid="legal-notice">
      By {action}, you agree to the{' '}
      <a href="/terms" target="_blank" className={LINK_CLASS}>
        Terms of Service<span className="sr-only"> (opens in a new tab)</span>
      </a>{' '}
      and acknowledge the{' '}
      <a href="/privacy" target="_blank" className={LINK_CLASS}>
        Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
      </a>
      .
    </p>
  )
}
