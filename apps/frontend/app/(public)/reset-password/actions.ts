'use server'

import { createClient } from '@/utils/supabase/server'
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_MESSAGE, passwordPolicyErrorMessage } from '@/utils/password'

/** The field an error is about, so the form can mark and focus it. */
export type ResetPasswordField = 'password' | 'confirmPassword'

export async function updatePassword(
  formData: FormData
): Promise<{ success: boolean; error?: string; field?: ResetPasswordField }> {
  const supabase = await createClient()

  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  // Validate password confirmation
  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match', field: 'confirmPassword' }
  }

  // Validate password length
  if (!isPasswordLongEnough(password)) {
    return { success: false, error: PASSWORD_TOO_SHORT_MESSAGE, field: 'password' }
  }

  const { error } = await supabase.auth.updateUser({
    password: password,
  })

  if (error) {
    console.error('Password update error:', error.message)

    const policyMessage = passwordPolicyErrorMessage(error)
    if (policyMessage) {
      return { success: false, error: policyMessage, field: 'password' }
    }

    if (error.message.includes('should be different')) {
      return { success: false, error: 'New password must be different from your current password', field: 'password' }
    }

    return { success: false, error: 'Failed to update password. Please try again.' }
  }

  return { success: true }
}
