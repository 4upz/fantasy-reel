import type { Metadata } from 'next'
import BidHistoryPanel from '../../components/BidHistoryPanel'

export const metadata: Metadata = { title: 'Bid history' }

/** The History tab. Auth, league and roster loading all happen in the layout. */
export default function BidHistoryPage() {
  return <BidHistoryPanel />
}
