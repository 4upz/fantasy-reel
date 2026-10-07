import type { Metadata } from 'next'

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: 'Authentication error' }

export default function AuthCodeErrorLayout({ children }: { children: React.ReactNode }) {
  return children
}
