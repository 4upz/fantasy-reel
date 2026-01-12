import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { CinemaNav } from '../components/navigation'

interface Props {
  children: React.ReactNode
}

export default async function AuthenticatedLayout({ children }: Props) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch profile for navigation avatar display
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('user_id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-background">
      <CinemaNav user={user} profile={profile} />
      <main className="pt-16">
        {children}
      </main>
    </div>
  )
}
