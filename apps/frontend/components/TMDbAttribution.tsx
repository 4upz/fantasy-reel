'use client'

/**
 * TMDb Attribution Component
 *
 * Required attribution for using the TMDb API.
 * Displays the official TMDb logo with required disclaimer text.
 *
 * @see https://www.themoviedb.org/about/logos-attribution
 * @see https://developer.themoviedb.org/docs/faq#what-are-the-attribution-requirements
 */

interface Props {
  /** Visual variant - 'footer' for site footer, 'powered-by' for prominent display */
  variant?: 'footer' | 'powered-by'
  /** Optional additional className */
  className?: string
}

// TMDb brand colors (from https://www.themoviedb.org/about/logos-attribution)
const TMDB_SECONDARY = '#01b4e4' // Light blue
const TMDB_TERTIARY = '#90cea1' // Light green

function TMDbLogo({ size = 'medium' }: { size?: 'medium' | 'large' }) {
  const dimensions = size === 'large' ? { width: 120, height: 48 } : { width: 90, height: 36 }

  return (
    <svg
      width={dimensions.width}
      height={dimensions.height}
      viewBox="0 0 185.04 133.4"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="tmdb-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={TMDB_TERTIARY} />
          <stop offset="100%" stopColor={TMDB_SECONDARY} />
        </linearGradient>
      </defs>
      <g fill="url(#tmdb-gradient)">
        <path d="M51.06 66.7c0-18.42 14.93-33.35 33.35-33.35h66.7c18.42 0 33.35 14.93 33.35 33.35S169.53 100.05 151.11 100.05h-66.7c-18.42 0-33.35-14.93-33.35-33.35" />
        <path d="M51.06 66.7c0-18.42 14.93-33.35 33.35-33.35h66.7c18.42 0 33.35 14.93 33.35 33.35S169.53 100.05 151.11 100.05h-66.7c-18.42 0-33.35-14.93-33.35-33.35" />
        <path d="M0 66.7C0 29.86 29.86 0 66.7 0c36.84 0 66.7 29.86 66.7 66.7s-29.86 66.7-66.7 66.7C29.86 133.4 0 103.54 0 66.7m90.68-31.07h-23.6V49.4h7.9v35.2h7.8V49.4h7.9zm40.08 35.2V35.63h-7.8v23.76l-13.77-23.76h-7.1v49h7.8V60.58l14.07 24.25zm-60.63 0V35.63h-6.81v29.08l-10.81-29.08h-8.61v49h6.8v-30l11.12 30z" />
      </g>
    </svg>
  )
}

export default function TMDbAttribution({
  variant = 'footer',
  className = '',
}: Props): React.ReactElement {
  if (variant === 'powered-by') {
    return (
      <div className={`flex flex-col items-center gap-3 ${className}`}>
        <span className="text-xs uppercase tracking-widest text-foreground-muted font-medium">
          Powered by
        </span>
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-opacity hover:opacity-80"
          aria-label="The Movie Database (TMDb)"
        >
          <TMDbLogo size="large" />
        </a>
        <p className="text-xs text-foreground-muted max-w-xs text-center leading-relaxed">
          This product uses the{' '}
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#01b4e4] hover:text-[#90cea1] transition-colors"
          >
            TMDb
          </a>{' '}
          API but is not endorsed or certified by TMDb.
        </p>
      </div>
    )
  }

  // Footer variant
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <a
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 transition-opacity hover:opacity-80"
        aria-label="The Movie Database (TMDb)"
      >
        <TMDbLogo size="medium" />
      </a>
      <p className="text-xs text-foreground-muted leading-snug">
        This product uses the{' '}
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#01b4e4] hover:text-[#90cea1] transition-colors"
        >
          TMDb
        </a>{' '}
        API but is not endorsed or certified by TMDb.
      </p>
    </div>
  )
}
