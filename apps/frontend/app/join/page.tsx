import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import JoinLeagueClient from './JoinLeagueClient'

interface PageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function JoinPage({ searchParams }: PageProps) {
  const { token } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Redirect to login with return URL
    const returnUrl = token ? `/join?token=${token}` : '/join'
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)
  }

  return <JoinLeagueClient token={token} userEmail={user.email} />
}
