'use client'

import type { League } from '@/types'
import BiddingPanel from '../components/BiddingPanel'
import { useBidding } from '../hooks/useBidding'

interface Props {
  league: League
  teamId: string
  draftedTmdbIds: number[]
}

export default function BiddingClient({ league, teamId, draftedTmdbIds }: Props) {
  const {
    bids,
    myBids,
    budget,
    placeBid,
    cancelBid,
  } = useBidding({
    leagueId: league.id,
    teamId,
  })

  return (
    <BiddingPanel
      league={league}
      teamId={teamId}
      bids={bids}
      myBids={myBids}
      budget={budget}
      draftedTmdbIds={draftedTmdbIds}
      onPlaceBid={placeBid}
      onCancelBid={cancelBid}
    />
  )
}
