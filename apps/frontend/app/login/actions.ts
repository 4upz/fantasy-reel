'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function login(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
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
