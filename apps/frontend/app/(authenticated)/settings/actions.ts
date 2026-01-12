'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export interface UpdateProfileResult {
  success: boolean
  error?: string
}

async function getAuthenticatedUser(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }
  return { userId: user.id }
}

function revalidateProfilePaths(): void {
  revalidatePath('/settings')
  revalidatePath('/', 'layout')
}

export async function updateProfile(formData: FormData): Promise<UpdateProfileResult> {
  const authResult = await getAuthenticatedUser()
  if ('error' in authResult) {
    return { success: false, error: authResult.error }
  }

  const displayName = formData.get('display_name') as string
  const trimmedName = displayName?.trim() ?? ''

  if (trimmedName.length < 1) {
    return { success: false, error: 'Display name is required' }
  }

  if (trimmedName.length > 100) {
    return { success: false, error: 'Display name must be 100 characters or less' }
  }

  const supabase = await createClient()

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ display_name: trimmedName })
    .eq('user_id', authResult.userId)

  if (profileError) {
    console.error('Profile update error:', profileError)
    return { success: false, error: 'Failed to update profile' }
  }

  // Sync to user_metadata for navigation components (non-fatal if fails)
  const { error: authError } = await supabase.auth.updateUser({
    data: { display_name: trimmedName },
  })

  if (authError) {
    console.error('Failed to sync display_name to user_metadata:', authError)
  }

  revalidateProfilePaths()
  return { success: true }
}

export async function updateAvatarUrl(avatarUrl: string | null): Promise<UpdateProfileResult> {
  const authResult = await getAuthenticatedUser()
  if ('error' in authResult) {
    return { success: false, error: authResult.error }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('user_id', authResult.userId)

  if (error) {
    console.error('Avatar URL update error:', error)
    return { success: false, error: 'Failed to update avatar' }
  }

  revalidateProfilePaths()
  return { success: true }
}
