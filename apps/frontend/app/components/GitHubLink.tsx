import GitHubIcon from './icons/GitHubIcon'

export const GITHUB_REPO_URL = 'https://github.com/4upz/fantasy-reel'

interface Props {
  className?: string
}

/**
 * Footer link to the project's source on GitHub. Shared by the marketing and
 * authenticated footers so the label and destination stay in one place.
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
