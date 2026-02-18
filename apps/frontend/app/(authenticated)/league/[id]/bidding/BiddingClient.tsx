'use client'

import type { League } from '@/types'
import BiddingPanel from '../components/BiddingPanel'
import { useBidding } from '../hooks/useBidding'

interface Props {
  league: League
  teamId: string
  draftedTmdbIds: number[]
  biddingCounterpickSlots: number
}

export default function BiddingClient({
  league,
  teamId,
  draftedTmdbIds,
  biddingCounterpickSlots,
}: Props): React.ReactElement {
  const {
    bids,
    myBids,
    budget,
    placeBid,
    cancelBid,
    counterpickBids,
    myCounterpickBids,
    biddingCounterpickCount,
    placeCounterpickBid,
    cancelCounterpickBid,
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
      biddingCounterpickCount={biddingCounterpickCount}
      biddingCounterpickSlots={biddingCounterpickSlots}
      counterpickBids={counterpickBids}
      myCounterpickBids={myCounterpickBids}
      onPlaceCounterpickBid={placeCounterpickBid}
      onCancelCounterpickBid={cancelCounterpickBid}
    />
  )
}
