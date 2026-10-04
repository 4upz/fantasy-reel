'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface LegalLink {
  label: string
  href: string
  testId: string
}

/** Add new policy pages here; every footer picks them up. */
const LEGAL_LINKS: LegalLink[] = [
  { label: 'Privacy policy', href: '/privacy', testId: 'footer-privacy-link' },
]

/** Text links to the site's policy pages, shown in every footer. */
export default function LegalLinks(): React.ReactElement {
  const pathname = usePathname()

  return (
    <ul className="flex flex-wrap justify-center gap-x-1">
      {LEGAL_LINKS.map(({ label, href, testId }) => (
        <li key={href}>
          <Link
            href={href}
            className="type-label inline-flex min-h-11 items-center rounded-lg px-2 text-foreground-secondary underline-offset-4 transition-colors hover:text-gold hover:underline aria-[current=page]:text-foreground"
            aria-current={pathname === href ? 'page' : undefined}
            data-testid={testId}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  )
}
