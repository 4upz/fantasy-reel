import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import JoinLeagueClient from './JoinLeagueClient'

interface PageProps {
  searchParams: Promise<{ token?: string; code?: string }>
}

export default async function JoinPage({ searchParams }: PageProps) {
  const { token, code } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Redirect to login with return URL, preserving the token or code
    let returnUrl = '/join'
    if (token) {
      returnUrl = `/join?token=${token}`
    } else if (code) {
      returnUrl = `/join?code=${code}`
    }
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)
  }

  const displayName = user.user_metadata?.display_name || user.email || 'User'
  return <JoinLeagueClient token={token} code={code} userDisplayName={displayName} />
}
