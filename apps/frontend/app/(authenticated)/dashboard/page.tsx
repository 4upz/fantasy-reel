import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { getCachedMemberships, getCachedUiState } from '@/utils/supabase/cached'
import { isNewPlayer, nextStep, NEXT_STEP_PREF_KEY } from '@/utils/onboarding'
import DashboardClient from '../../components/DashboardClient'
import type { InvitationWithLeague } from '@/types'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch pending invitations server-side to avoid loading flicker
  // Note: Invitations are stored with lowercase emails (normalized in send-invite)
  const [{ data: invitationsData }, { data: memberships }, { data: uiState }] = await Promise.all([
    supabase
      .from('invitations')
      .select('*, leagues(id, name, status, owner_id)')
      .eq('status', 'pending')
      .eq('email', user?.email?.toLowerCase() ?? '')
      .gte('expires_at', new Date().toISOString())
      .order('sent_at', { ascending: false }),
    // Onboarding: whether this is a newcomer, and what they should do next.
    // The UI state read is shared with the authenticated layout's.
    getCachedMemberships(user?.id ?? ''),
    getCachedUiState(user?.id ?? ''),
  ])

  // Filter out invitations where the league was deleted or inaccessible
  const pendingInvitations = (invitationsData ?? []).filter(
    (inv): inv is InvitationWithLeague => inv.leagues !== null
  )

  // A failed read leaves both null: no automatic tour, no card.
  const nextStepHidden = uiState?.some((row) => row.key === NEXT_STEP_PREF_KEY && row.value?.hidden === true) ?? false

  return (
    <DashboardClient
      pendingInvitations={pendingInvitations}
      newPlayer={isNewPlayer(memberships)}
      nextStep={memberships && user && !nextStepHidden ? nextStep(memberships, user.id) : null}
    />
  )
}
