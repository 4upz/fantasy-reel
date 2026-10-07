import GitHubIcon from './icons/GitHubIcon'

export const GITHUB_REPO_URL = 'https://github.com/4upz/fantasy-reel'

interface SocialLink {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  testId: string
}

/** Add new profiles here; every SocialLinks row picks them up. */
const SOCIAL_LINKS: SocialLink[] = [
  { label: 'Fantasy Reel on GitHub', href: GITHUB_REPO_URL, icon: GitHubIcon, testId: 'social-link-github' },
]

interface Props {
  className?: string
}

/**
 * Row of icon-only links to the project's external profiles.
 *
 * @design-system Identity & brand
 */
export default function SocialLinks({ className = '' }: Props): React.ReactElement {
  return (
    <ul className={`social-links ${className}`}>
      {SOCIAL_LINKS.map(({ label, href, icon: Icon, testId }) => (
        <li key={href}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label={`${label} (opens in a new tab)`}
            title={label}
            data-testid={testId}
          >
            <Icon className="h-5 w-5" />
          </a>
        </li>
      ))}
    </ul>
  )
}
