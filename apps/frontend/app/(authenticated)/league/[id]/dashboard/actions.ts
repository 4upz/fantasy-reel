'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export interface UpdateTeamResult {
  success: boolean
  error?: string
}

function revalidateLeaguePaths(leagueId: string): void {
  revalidatePath(`/league/${leagueId}/dashboard`)
  revalidatePath(`/league/${leagueId}/standings`)
  revalidatePath(`/league/${leagueId}/roster`)
}

export async function updateTeamName(
  teamId: string,
  leagueId: string,
  formData: FormData
): Promise<UpdateTeamResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const name = formData.get('name') as string
  const trimmed = name?.trim() ?? ''

  if (!trimmed) {
    return { success: false, error: 'Team name is required' }
  }

  if (trimmed.length > 100) {
    return { success: false, error: 'Team name must be 100 characters or less' }
  }

  const { error } = await supabase
    .from('teams')
    .update({ name: trimmed })
    .eq('id', teamId)

  if (error) {
    console.error('Team name update error:', error)
    return { success: false, error: 'Failed to update team name' }
  }

  revalidateLeaguePaths(leagueId)
  return { success: true }
}

export async function updateTeamAvatarUrl(
  teamId: string,
  leagueId: string,
  avatarUrl: string | null
): Promise<UpdateTeamResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { error } = await supabase
    .from('teams')
    .update({ avatar_url: avatarUrl })
    .eq('id', teamId)

  if (error) {
    console.error('Team avatar update error:', error)
    return { success: false, error: 'Failed to update team avatar' }
  }

  revalidateLeaguePaths(leagueId)
  return { success: true }
}
