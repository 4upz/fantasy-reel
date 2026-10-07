import type { Metadata } from 'next'

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: 'Reset password' }

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
