import { redirect } from 'next/navigation'
import SideNav from '../components/navigation/SideNav'
import SiteFooterContent from '../components/SiteFooterContent'
import { getCachedUser, getCachedProfile } from '@/utils/supabase/cached'
import { AuthenticatedProviders } from './Providers'
import { DISCORD_GUIDE_ID } from '@/utils/discordBot'

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
    <div className="flex min-h-dvh flex-col bg-background">
      <SideNav user={user} profile={profile} />
      {/* Mobile: top padding for header. Desktop: left padding for sidebar (uses CSS custom property) */}
      <AuthenticatedProviders>
        <main className="flex-1 pt-14 lg:pt-0 lg:pl-[var(--sidenav-width,68px)] transition-[padding] duration-250 ease-out">
          {children}
        </main>
        {/* TMDb requires the attribution notice wherever their data is shown,
            and every authenticated page shows it. */}
        <footer className="shrink-0 border-t border-border lg:pl-[var(--sidenav-width,68px)] transition-[padding] duration-250 ease-out">
          <SiteFooterContent className="px-6 py-6" discordGuideHref={`/help#${DISCORD_GUIDE_ID}`} />
        </footer>
      </AuthenticatedProviders>
    </div>
  )
}
