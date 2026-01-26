'use server'

import { createClient } from '@/utils/supabase/server'

export async function updatePassword(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  // Validate password confirmation
  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match' }
  }

  // Validate password length
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' }
  }

  const { error } = await supabase.auth.updateUser({
    password: password,
  })

  if (error) {
    console.error('Password update error:', error.message)

    if (error.message.includes('should be different')) {
      return { success: false, error: 'New password must be different from your current password' }
    }

    return { success: false, error: 'Failed to update password. Please try again.' }
  }

  return { success: true }
}
