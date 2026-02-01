'use server'

import { createClient } from '@/utils/supabase/server'
import { getDisplayNameFromUser, getAvatarUrlFromUser } from '@/utils/oauth'
import { cookies } from 'next/headers'

interface ActionResult {
  success: boolean
  error?: string
}

export async function verifyAndMergeAccounts(
  password: string,
  duplicateUserId: string,
  email: string,
  provider: 'discord' | 'google'
): Promise<ActionResult> {
  const supabase = await createClient()

  // Step 1: Verify the password against the original account
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError || !signInData.user) {
    return { success: false, error: 'Incorrect password. Please try again.' }
  }

  const originalUserId = signInData.user.id

  // Make sure we're not trying to merge the same account
  if (originalUserId === duplicateUserId) {
    // Clear the cookie and redirect - they're already signed in
    const cookieStore = await cookies()
    cookieStore.delete('link_account_context')
    return { success: true }
  }

  // Step 2: Call the edge function to merge accounts
  const { data, error: mergeError } = await supabase.functions.invoke('merge-accounts', {
    body: {
      originalUserId,
      duplicateUserId,
      provider,
    },
  })

  if (mergeError) {
    console.error('Merge accounts error:', mergeError)
    return { success: false, error: 'Failed to link accounts. Please try again.' }
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Failed to link accounts.' }
  }

  // Step 3: Clear the context cookie
  const cookieStore = await cookies()
  cookieStore.delete('link_account_context')

  // The user is now signed in as the original account with Discord linked
  return { success: true }
}

export async function keepSeparateAccount(duplicateUserId: string): Promise<ActionResult> {
  const supabase = await createClient()

  // Get the current user (should be the duplicate Discord account)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.id !== duplicateUserId) {
    return { success: false, error: 'Session error. Please try again.' }
  }

  // Create a profile for the duplicate account if it doesn't exist
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('user_id', duplicateUserId)
    .single()

  if (!existingProfile) {
    const { error: profileError } = await supabase.from('profiles').insert({
      user_id: duplicateUserId,
      display_name: getDisplayNameFromUser(user),
      avatar_url: getAvatarUrlFromUser(user),
    })

    if (profileError) {
      console.error('Profile creation error:', profileError)
      return { success: false, error: 'Failed to create account. Please try again.' }
    }
  }

  // Clear the context cookie
  const cookieStore = await cookies()
  cookieStore.delete('link_account_context')

  return { success: true }
}
