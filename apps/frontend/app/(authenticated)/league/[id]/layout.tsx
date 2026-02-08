import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getCachedUser } from '@/utils/supabase/cached'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import LeagueSwitcher from './components/LeagueSwitcher'
import LeagueTabs from './components/LeagueTabs'
import type { League } from '@/types'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function LeagueLayout({ children, params }: LayoutProps): Promise<React.ReactElement> {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await getCachedUser()
  if (!user) {
    redirect('/login')
  }

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  const [memberResult, countResult] = await Promise.all([
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

  if (!memberResult.data) {
    redirect('/dashboard')
  }

  const typedLeague = league as League
  const isOwner = typedLeague.owner_id === user.id
  const participantCount = countResult.count ?? 0

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <LeagueSwitcher currentLeagueId={typedLeague.id} currentLeagueName={typedLeague.name} />

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className={`badge ${STATUS_BADGE_CLASS[typedLeague.status]}`}>
            {getStatusLabel(typedLeague.status)}
          </span>
          <span className="text-sm text-foreground-muted">
            {typedLeague.invite_only ? 'Invite Only' : 'Open'}
          </span>
          <span className="text-sm text-foreground-muted">
            {participantCount} / {typedLeague.max_participants} participants
          </span>
        </div>

        <div className="mb-6">
          <LeagueTabs league={typedLeague} isOwner={isOwner} />
        </div>

        {children}
      </div>
    </div>
  )
}
