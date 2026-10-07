import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { safeRedirectPath } from '@/utils/redirect'

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    await supabase.auth.signOut()
  }

  // "Sign in again" flows send where to return to after signing back in.
  const form = await request.formData().catch(() => null)
  const next = safeRedirectPath(form?.get('next')?.toString(), '')

  revalidatePath('/', 'layout')
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
}