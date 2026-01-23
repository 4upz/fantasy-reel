import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import type { League } from '@/types'
import LeagueTabs from './components/LeagueTabs'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function LeagueLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Check if user is a participant
  const { data: userParticipant } = await supabase
    .from('league_participants')
    .select('id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!userParticipant) {
    redirect('/dashboard')
  }

  // Get participant count
  const { count: participantCount } = await supabase
    .from('league_participants')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', id)
    .eq('status', 'active')

  const isOwner = league.owner_id === user.id
  const typedLeague = league as League

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* League Header */}
        <div className="card p-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">
              {typedLeague.name}
            </h1>
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <span className={`badge ${STATUS_BADGE_CLASS[typedLeague.status]}`}>
                {getStatusLabel(typedLeague.status)}
              </span>
              <span className="text-sm text-foreground-muted">
                {typedLeague.invite_only ? 'Invite Only' : 'Open'}
              </span>
              <span className="text-sm text-foreground-muted">
                {participantCount ?? 0} / {typedLeague.max_participants} participants
              </span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-4">
            <LeagueTabs league={typedLeague} isOwner={isOwner} />
          </div>
        </div>

        {/* Page Content */}
        <div className="mt-4">
          {children}
        </div>
      </div>
    </div>
  )
}
