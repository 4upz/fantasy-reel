import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LeagueRootPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch league status for phase-aware redirect
  const { data: league, error } = await supabase
    .from('leagues')
    .select('status')
    .eq('id', id)
    .single()

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
