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

  return (
    <div className="min-h-screen bg-background">
      <CinemaNav user={user} />
      <main className="pt-16">
        {children}
      </main>
    </div>
  )
}
