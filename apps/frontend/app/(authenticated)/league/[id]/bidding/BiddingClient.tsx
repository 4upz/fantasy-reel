'use client'

import type { League } from '@/types'
import BiddingPanel from '../components/BiddingPanel'
import { useBidding } from '../hooks/useBidding'

interface Props {
  league: League
  teamId: string
  ownedTmdbIds: number[]
  usedPickupSlots: number
  biddingCounterpickSlots: number
}

export default function BiddingClient({
  league,
  teamId,
  ownedTmdbIds,
  usedPickupSlots,
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
    setCounterpickBidPriorities,
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
      ownedTmdbIds={ownedTmdbIds}
      usedPickupSlots={usedPickupSlots}
      onPlaceBid={placeBid}
      onCancelBid={cancelBid}
      biddingCounterpickCount={biddingCounterpickCount}
      biddingCounterpickSlots={biddingCounterpickSlots}
      counterpickBids={counterpickBids}
      myCounterpickBids={myCounterpickBids}
      onPlaceCounterpickBid={placeCounterpickBid}
      onCancelCounterpickBid={cancelCounterpickBid}
      onReorderCounterpickBids={setCounterpickBidPriorities}
    />
  )
}
