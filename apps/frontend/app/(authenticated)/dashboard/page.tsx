import { createClient } from '@/utils/supabase/server'
import DashboardClient from '../../components/DashboardClient'
import type { InvitationWithLeague } from '@/types'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch pending invitations server-side to avoid loading flicker
  const { data: invitationsData } = await supabase
    .from('invitations')
    .select('*, leagues(id, name, status, owner_id)')
    .eq('status', 'pending')
    .eq('email', user?.email ?? '')
    .gte('expires_at', new Date().toISOString())
    .order('sent_at', { ascending: false })

  // Filter out invitations where the league was deleted or inaccessible
  const pendingInvitations = (invitationsData ?? []).filter(
    (inv): inv is InvitationWithLeague => inv.leagues !== null
  )

  return <DashboardClient pendingInvitations={pendingInvitations} />
}
