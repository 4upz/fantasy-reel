import type { Metadata } from 'next'
import ActiveBidsPanel from '../components/ActiveBidsPanel'

export const metadata: Metadata = { title: 'Bidding' }

/** The Active tab. Auth, league and roster loading all happen in the layout. */
export default function BiddingPage() {
  return <ActiveBidsPanel />
}
