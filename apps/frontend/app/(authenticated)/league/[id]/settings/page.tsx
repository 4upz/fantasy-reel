import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SettingsClient from './SettingsClient'
import type { League, ParticipantWithProfile } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LeagueSettingsPage({ params }: PageProps) {
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

  // Only owner can access settings
  if (league.owner_id !== user.id) {
    redirect(`/league/${id}`)
  }

  // Fetch participants with their teams and profiles
  const { data: participants } = await supabase
    .from('league_participants')
    .select(`
      *,
      teams (*),
      profiles:user_id (*)
    `)
    .eq('league_id', id)
    .eq('status', 'active')
    .order('draft_order', { ascending: true })

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <SettingsClient
          league={league as League}
          participants={(participants || []) as ParticipantWithProfile[]}
          currentUserId={user.id}
        />
      </div>
    </div>
  )
}
