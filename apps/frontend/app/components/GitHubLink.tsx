import GitHubIcon from './icons/GitHubIcon'
import { GITHUB_REPO_URL } from './SocialLinks'

interface Props {
  className?: string
}

/**
 * Labeled link to the project's source on GitHub, for the marketing footer.
 * The app shell uses the icon-only SocialLinks row instead.
 *
 * @design-system Identity & brand
 */
export default function GitHubLink({ className = '' }: Props): React.ReactElement {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`type-meta inline-flex min-h-11 items-center gap-2 text-foreground-secondary transition-colors hover:text-gold ${className}`}
      data-testid="github-link"
    >
      <GitHubIcon className="h-4 w-4" />
      <span>View on GitHub</span>
    </a>
  )
}
