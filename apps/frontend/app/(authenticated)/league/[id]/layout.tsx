import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import type { League } from '@/types'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import { getCachedUser } from '@/utils/supabase/cached'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function LeagueLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await getCachedUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league first (required for validation)
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Parallelize participant check and count queries (async-parallel optimization)
  const [userParticipantResult, participantCountResult] = await Promise.all([
    supabase
      .from('league_participants')
      .select('id')
      .eq('league_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single(),
    supabase
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', id)
      .eq('status', 'active'),
  ])

  if (!userParticipantResult.data) {
    redirect('/dashboard')
  }

  const participantCount = participantCountResult.count
  const typedLeague = league as League

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* League Header - Compact info bar */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
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

        {/* Page Content */}
        {children}
      </div>
    </div>
  )
}
