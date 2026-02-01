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

export async function changePassword(formData: FormData): Promise<UpdateProfileResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return { success: false, error: 'Not authenticated' }
  }

  const currentPassword = formData.get('currentPassword') as string
  const newPassword = formData.get('newPassword') as string
  const confirmPassword = formData.get('confirmPassword') as string

  // Validate inputs
  if (!currentPassword || !newPassword || !confirmPassword) {
    return { success: false, error: 'All fields are required' }
  }

  if (newPassword !== confirmPassword) {
    return { success: false, error: 'New passwords do not match' }
  }

  if (newPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters' }
  }

  // Re-authenticate with current password to verify it's correct
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })

  if (signInError) {
    if (signInError.message.includes('Invalid login credentials')) {
      return { success: false, error: 'Current password is incorrect' }
    }
    console.error('Re-authentication error:', signInError)
    return { success: false, error: 'Failed to verify current password' }
  }

  // Update to new password
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (updateError) {
    console.error('Password update error:', updateError.message)

    if (updateError.message.includes('should be different')) {
      return { success: false, error: 'New password must be different from your current password' }
    }

    return { success: false, error: 'Failed to update password. Please try again.' }
  }

  return { success: true }
}

export async function unlinkIdentity(identityId: string): Promise<UpdateProfileResult> {
  const supabase = await createClient()

  // Get current user and their identities
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: identities } = await supabase.auth.getUserIdentities()

  // Safety check: ensure user has at least 2 identities or has a password
  const emailIdentity = identities?.identities?.find((i) => i.provider === 'email')
  const hasPassword = !!emailIdentity

  if (!hasPassword && (identities?.identities?.length ?? 0) <= 1) {
    return { success: false, error: 'Cannot disconnect - this is your only sign-in method' }
  }

  // Find the identity to unlink
  const identityToUnlink = identities?.identities?.find((i) => i.identity_id === identityId)
  if (!identityToUnlink) {
    return { success: false, error: 'Identity not found' }
  }

  const { error } = await supabase.auth.unlinkIdentity(identityToUnlink)

  if (error) {
    console.error('Unlink identity error:', error)
    return { success: false, error: 'Failed to disconnect account' }
  }

  revalidateProfilePaths()
  return { success: true }
}
