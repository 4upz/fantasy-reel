import { getCachedLeague } from '@/utils/supabase/cached'
import { redirect, notFound } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LeagueRootPage({ params }: PageProps) {
  const { id } = await params

  // Fetch league status for phase-aware redirect
  const { data: league, error } = await getCachedLeague(id)

  if (error || !league) {
    notFound()
  }

  // Phase-aware default tab:
  // - Setup/Drafting/Counterpicking: Draft tab (the main event)
  // - Active/Completed: Dashboard tab (team performance)
  const draftPhaseStatuses = new Set(['setup', 'drafting', 'counterpicking'])

  if (draftPhaseStatuses.has(league.status)) {
    redirect(`/league/${id}/draft`)
  }

  redirect(`/league/${id}/dashboard`)
}
