'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { League, ParticipantWithProfile } from '@/types'
import { getParticipantDisplayName } from '@/utils/league'
import LeagueInfoSection from './components/LeagueInfoSection'
import JoinLinkSection from './components/JoinLinkSection'
import DraftConfigSection from './components/DraftConfigSection'
import DraftOrderSection from './components/DraftOrderSection'
import CounterpickConfigSection from './components/CounterpickConfigSection'
import BiddingConfigSection from './components/BiddingConfigSection'
import TradeConfigSection from './components/TradeConfigSection'
import ParticipantsSection from './components/ParticipantsSection'
import DiscordAnnouncementSection from './components/DiscordAnnouncementSection'
import SeasonSection from './components/SeasonSection'
import DangerZoneSection from './components/DangerZoneSection'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  currentUserId: string
}

export default function SettingsClient({
  league: initialLeague,
  participants: initialParticipants,
  currentUserId,
}: Props): React.ReactElement {
  const router = useRouter()
  const [league, setLeague] = useState(initialLeague)
  const [participants, setParticipants] = useState(initialParticipants)

  const isSetup = league.status === 'setup'

  // Names, not ids: the rollover confirm lists who is being carried over, and
  // "Alice Spielberg" is the only version of that a commissioner can check.
  const participantNames = participants.map((p) => getParticipantDisplayName(p, 'Unnamed player'))

  function handleLeagueUpdate(updatedLeague: League): void {
    setLeague(updatedLeague)
  }

  function handleParticipantKicked(participantId: string): void {
    setParticipants((prev) => prev.filter((p) => p.id !== participantId))
  }

  function handleParticipantsReordered(updated: ParticipantWithProfile[]): void {
    setParticipants(updated)
  }

  function handleLeagueDeleted(): void {
    router.push('/dashboard')
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground">
          League Settings
        </h1>
        <p className="text-foreground-secondary mt-2">
          Manage settings for <span className="text-foreground font-medium">{league.name}</span>
        </p>
      </header>

      {/* Settings Sections */}
      <div className="space-y-6">
        <LeagueInfoSection
          league={league}
          onUpdate={handleLeagueUpdate}
        />

        <JoinLinkSection
          league={league}
          isLocked={!isSetup}
          onUpdate={handleLeagueUpdate}
        />

        <DraftConfigSection
          league={league}
          participantCount={participants.length}
          isLocked={!isSetup}
          onUpdate={handleLeagueUpdate}
        />

        <DraftOrderSection
          league={league}
          participants={participants}
          isLocked={!isSetup}
          onReorder={handleParticipantsReordered}
        />

        <CounterpickConfigSection
          league={league}
          isLocked={!isSetup}
          onUpdate={handleLeagueUpdate}
        />

        <BiddingConfigSection
          league={league}
          isLocked={!isSetup}
          onUpdate={handleLeagueUpdate}
        />

        {/* No isLocked: trade settings stay editable through the season, which
            is the whole point of a deadline and a review window. */}
        <TradeConfigSection
          league={league}
          onUpdate={handleLeagueUpdate}
        />

        {/* Above the Danger Zone on purpose: ending a season completes a
            record, it does not destroy one. */}
        <SeasonSection
          league={league}
          participantNames={participantNames}
          onUpdate={handleLeagueUpdate}
        />

        <ParticipantsSection
          league={league}
          participants={participants}
          currentUserId={currentUserId}
          isLocked={!isSetup}
          onKick={handleParticipantKicked}
        />

        <DiscordAnnouncementSection leagueId={league.id} />

        <DangerZoneSection
          league={league}
          isLocked={!isSetup}
          onDelete={handleLeagueDeleted}
        />
      </div>
    </div>
  )
}
