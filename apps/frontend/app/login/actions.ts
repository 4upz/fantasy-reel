'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  console.log('Attempting login with:', { email: data.email, hasPassword: !!data.password })

  const { data: authData, error } = await supabase.auth.signInWithPassword(data)

  console.log('Login result:', { 
    success: !error, 
    error: error ? {
      message: error.message,
      status: error.status,
      name: error.name
    } : null,
    user: authData?.user?.id || null
  })

  if (error) {
    console.error('Login failed:', error)
    redirect('/error')
  }

  console.log('Login successful, redirecting to dashboard')
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

