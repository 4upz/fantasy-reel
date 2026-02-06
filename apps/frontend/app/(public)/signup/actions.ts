'use server'

import { createClient } from '@/utils/supabase/server'
import { headers } from 'next/headers'

export async function signup(formData: FormData): Promise<{ success: boolean; error?: string }> {
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
    }
  })

  if (error) {
    // Return user-friendly error messages
    if (error.message.includes('already registered')) {
      return { success: false, error: 'An account with this email already exists' }
    }
    return { success: false, error: error.message }
  }

  // Don't redirect - let the client show the "check your email" message
  return { success: true }
}
