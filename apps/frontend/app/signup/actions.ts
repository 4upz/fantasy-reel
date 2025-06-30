'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  // Validate password confirmation
  if (password !== confirmPassword) {
    redirect('/signup?error=passwords_dont_match')
  }

  const data = {
    email: formData.get('email') as string,
    password: password,
    options: {
      data: {
        display_name: formData.get('displayName') as string,
      }
    }
  }

  const { error } = await supabase.auth.signUp(data)

  if (error) {
    redirect('/error')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}