import { redirect } from 'next/navigation'
import TMDbAttribution from '@/components/TMDbAttribution'
import SideNav from '../components/navigation/SideNav'
import { getCachedUser, getCachedProfile } from '@/utils/supabase/cached'
import { AuthenticatedProviders } from './Providers'

interface Props {
  children: React.ReactNode
}

export default async function AuthenticatedLayout({ children }: Props) {
  const {
    data: { user },
  } = await getCachedUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch profile for navigation avatar display (cached for request deduplication)
  const { data: profile } = await getCachedProfile(user.id)

  return (
    <div className="min-h-screen bg-background">
      <SideNav user={user} profile={profile} />
      {/* Mobile: top padding for header. Desktop: left padding for sidebar (uses CSS custom property) */}
      <AuthenticatedProviders>
        <main className="pt-14 lg:pt-0 lg:pl-[var(--sidenav-width,68px)] transition-[padding] duration-250 ease-out">
          {children}
        </main>
        {/* TMDb requires the attribution notice wherever their data is shown,
            and every authenticated page shows it. */}
        <footer className="border-t border-border lg:pl-[var(--sidenav-width,68px)] transition-[padding] duration-250 ease-out">
          <div className="max-w-7xl mx-auto px-6 py-6 flex justify-center">
            <TMDbAttribution variant="footer" />
          </div>
        </footer>
      </AuthenticatedProviders>
    </div>
  )
}
