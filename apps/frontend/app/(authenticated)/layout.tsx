import { redirect } from 'next/navigation'
import CinemaNav from '../components/navigation/CinemaNav'
import { getCachedUser, getCachedProfile } from '@/utils/supabase/cached'

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
      <CinemaNav user={user} profile={profile} />
      <main className="pt-16">
        {children}
      </main>
    </div>
  )
}
