import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getCachedUser } from '@/utils/supabase/cached'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import LeagueSwitcher from './components/LeagueSwitcher'
import LeagueTabs from './components/LeagueTabs'
import LeagueBottomNav from './components/LeagueBottomNav'
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

  const accessLabel = typedLeague.invite_only ? 'Invite Only' : 'Open'

  // Only a league still in setup can be joined, so the open slots are only news
  // while they can be filled. After that, show the roster of players who are in.
  const participantLabel =
    typedLeague.status === 'setup'
      ? `${participantCount} / ${typedLeague.max_participants} participants`
      : `${participantCount} ${participantCount === 1 ? 'participant' : 'participants'}`

  return (
    <div className="min-h-screen bg-background">
      {/*
        One header, two shapes. On mobile it condenses to two lines - name + status,
        then the meta - and pins below the app's fixed 56px mobile header so the
        league you are looking at stays named while the table scrolls. On desktop it
        unwraps into today's three rows. Rendering it once keeps a single <h1> and a
        single switcher rather than a hidden duplicate of each.
      */}
      <div className="sticky top-14 z-20 border-b border-border bg-background lg:static lg:z-auto lg:border-0">
        <div className="mx-auto max-w-6xl px-4 pt-1.5 pb-2.5 sm:px-6 lg:px-8 lg:pt-6 lg:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 lg:gap-x-3">
            {/* Shares line 1 with the badge on mobile; owns its own row on desktop */}
            <div className="min-w-0 flex-1 lg:basis-full lg:flex-none">
              <LeagueSwitcher currentLeagueId={typedLeague.id} currentLeagueName={typedLeague.name} />
            </div>

            <span className={`badge flex-none ${STATUS_BADGE_CLASS[typedLeague.status]}`}>
              {getStatusLabel(typedLeague.status)}
            </span>

            <div className="flex basis-full items-center gap-1.5 text-xs text-foreground-muted lg:basis-auto lg:gap-3 lg:text-sm">
              <span>{accessLabel}</span>
              <span className="lg:hidden">·</span>
              <span>{participantLabel}</span>
            </div>
          </div>

          <div className="mt-3 mb-6 hidden lg:block">
            <LeagueTabs league={typedLeague} isOwner={isOwner} />
          </div>
        </div>
      </div>

      {/* pb clears the fixed bottom bar on mobile */}
      <div className="mx-auto max-w-6xl px-4 pt-3.5 pb-[110px] sm:px-6 lg:px-8 lg:pt-0 lg:pb-6">
        {children}
      </div>

      <LeagueBottomNav league={typedLeague} isOwner={isOwner} />
    </div>
  )
}
