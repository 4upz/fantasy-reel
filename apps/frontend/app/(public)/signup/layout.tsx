import type { Metadata } from 'next'

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: 'Create your account' }

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
