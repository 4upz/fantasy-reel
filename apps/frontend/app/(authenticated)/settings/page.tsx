import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/types'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch profile from database
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        {/* Page Header */}
        <header className="mb-8 sm:mb-12 animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground tracking-tight">
            Settings
          </h1>
          <p className="mt-2 text-foreground-secondary">
            Manage your profile and account preferences
          </p>
        </header>

        {/* Settings Content */}
        <SettingsClient
          userId={user.id}
          profile={profile as Profile | null}
          email={user.email ?? ''}
        />
      </div>
    </div>
  )
}
