import { createClient } from '@/utils/supabase/server'
import LeagueManager from '../../components/LeagueManager'
import PendingInvitations from '../../components/PendingInvitations'
import type { InvitationWithLeague } from '@/types'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch pending invitations server-side to avoid loading flicker
  const { data: invitationsData } = await supabase
    .from('invitations')
    .select('*, leagues(id, name, status, owner_id)')
    .eq('status', 'pending')
    .eq('email', user?.email ?? '')
    .gte('expires_at', new Date().toISOString())
    .order('sent_at', { ascending: false })

  // Filter out invitations where the league was deleted or inaccessible
  const pendingInvitations = (invitationsData ?? []).filter(
    (inv): inv is InvitationWithLeague => inv.leagues !== null
  )

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      {/* Welcome section - simplified since nav shows user */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold font-display text-foreground">
          Your Leagues
        </h1>
        <p className="text-foreground-secondary mt-2">
          Create or join fantasy movie leagues and start drafting.
        </p>
      </div>

      <PendingInvitations initialInvitations={pendingInvitations} />
      <LeagueManager />
    </div>
  )
}
