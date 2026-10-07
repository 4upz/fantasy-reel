'use server'

import { createClient } from '@/utils/supabase/server'
import { headers } from 'next/headers'
import { CAPTCHA_FAILED_MESSAGE, isCaptchaError, readCaptchaToken } from '@/utils/captcha'
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_MESSAGE, passwordPolicyErrorMessage } from '@/utils/password'

/** The field an error is about, so the form can mark and focus it. */
export type SignupField = 'email' | 'password' | 'confirmPassword'

export async function signup(
  formData: FormData
): Promise<{ success: boolean; error?: string; field?: SignupField }> {
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

  // Get the origin for the email redirect URL
  const headersList = await headers()
  const origin = headersList.get('origin') || headersList.get('x-forwarded-host') || 'http://localhost:3000'
  const protocol = headersList.get('x-forwarded-proto') || 'http'
  const baseUrl = origin.startsWith('http') ? origin : `${protocol}://${origin}`

  const { error } = await supabase.auth.signUp({
    email: formData.get('email') as string,
    password: password,
    options: {
      data: {
        display_name: formData.get('displayName') as string,
      },
      emailRedirectTo: `${baseUrl}/auth/callback`,
      captchaToken: readCaptchaToken(formData),
    }
  })

  if (error) {
    if (isCaptchaError(error)) {
      return { success: false, error: CAPTCHA_FAILED_MESSAGE }
    }
    const policyMessage = passwordPolicyErrorMessage(error)
    if (policyMessage) {
      return { success: false, error: policyMessage, field: 'password' }
    }
    // Return user-friendly error messages
    if (error.message.includes('already registered')) {
      return { success: false, error: 'An account with this email already exists', field: 'email' }
    }
    return { success: false, error: error.message }
  }

  // Don't redirect - let the client show the "check your email" message
  return { success: true }
}
