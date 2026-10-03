'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CAPTCHA_FAILED_MESSAGE, isCaptchaError, readCaptchaToken } from '@/utils/captcha'

export async function resendConfirmationEmail(
  email: string,
  captchaToken?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  // Basic email validation
  if (!email || !email.includes('@')) {
    return { success: false, error: 'Please enter a valid email address' }
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { captchaToken },
  })

  // Always return success to avoid revealing if email exists (privacy)
  // Supabase's built-in rate limiting handles abuse prevention
  if (error) {
    // Log error server-side for debugging but don't expose details
    console.error('Resend confirmation error:', error.message)

    if (isCaptchaError(error)) {
      return { success: false, error: CAPTCHA_FAILED_MESSAGE }
    }

    // Only show rate limit errors to users (these don't reveal account existence)
    if (error.message.includes('rate limit') || error.message.includes('60 seconds') || error.message.includes('For security purposes')) {
      return {
        success: false,
        error: 'Please wait a minute before requesting another email',
      }
    }
  }

  // Generic success message regardless of whether email was actually sent
  return { success: true }
}

export async function login(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    options: { captchaToken: readCaptchaToken(formData) },
  })

  if (error) {
    if (isCaptchaError(error)) {
      return { success: false, error: CAPTCHA_FAILED_MESSAGE }
    }
    // Return user-friendly error messages
    if (error.message.includes('Invalid login credentials')) {
      return { success: false, error: 'Invalid email or password' }
    }
    if (error.message.includes('Email not confirmed')) {
      return { success: false, error: 'Please confirm your email address before signing in' }
    }
    return { success: false, error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
