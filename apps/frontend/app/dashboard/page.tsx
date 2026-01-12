import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import LeagueManager from '../components/LeagueManager'
import PendingInvitations from '../components/PendingInvitations'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold font-display text-foreground">
                Welcome to Fantasy Reel!
              </h1>
              <p className="text-foreground-secondary mt-2">
                Hello, {user.email}! Manage your movie leagues below.
              </p>
            </div>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn-danger">
                Sign out
              </button>
            </form>
          </div>
        </div>

        <PendingInvitations />
        <LeagueManager />
      </div>
    </div>
  )
}
