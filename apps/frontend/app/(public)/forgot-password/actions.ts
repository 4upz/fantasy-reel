'use server'

import { createClient } from '@/utils/supabase/server'
import { headers } from 'next/headers'

export async function requestPasswordReset(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const email = formData.get('email') as string

  if (!email || !email.includes('@')) {
    return { success: false, error: 'Please enter a valid email address' }
  }

  // Get the origin for the redirect URL
  const headersList = await headers()
  const origin = headersList.get('origin') || headersList.get('x-forwarded-host') || 'http://localhost:3000'
  const protocol = headersList.get('x-forwarded-proto') || 'http'
  const baseUrl = origin.startsWith('http') ? origin : `${protocol}://${origin}`

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${baseUrl}/reset-password`,
  })

  if (error) {
    console.error('Password reset error:', error.message)

    // Only show rate limit errors to users
    if (error.message.includes('rate limit') || error.message.includes('60 seconds') || error.message.includes('For security purposes')) {
      return {
        success: false,
        error: 'Please wait a minute before requesting another email',
      }
    }
  }

  // Always return success to avoid revealing if email exists (security best practice)
  return { success: true }
}
