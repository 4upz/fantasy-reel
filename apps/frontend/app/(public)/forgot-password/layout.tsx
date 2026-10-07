import type { Metadata } from 'next'

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: 'Forgot password' }

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
