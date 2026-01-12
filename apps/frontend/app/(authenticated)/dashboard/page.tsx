import Link from 'next/link'
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

      {/* Quick actions */}
      <div className="mb-8">
        <Link
          href="/movies"
          className="card card-interactive inline-flex items-center gap-3 px-5 py-4"
        >
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-muted">
            <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <div>
            <span className="font-display font-semibold text-foreground">Browse Movies</span>
            <p className="text-sm text-foreground-muted">Search and discover upcoming releases</p>
          </div>
          <svg className="w-5 h-5 text-foreground-muted ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      <PendingInvitations initialInvitations={pendingInvitations} />
      <LeagueManager />
    </div>
  )
}
