'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { League, ParticipantWithProfile } from '@/types'
import LeagueInfoSection from './components/LeagueInfoSection'
import DraftConfigSection from './components/DraftConfigSection'
import ParticipantsSection from './components/ParticipantsSection'
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

  function handleLeagueUpdate(updatedLeague: League): void {
    setLeague(updatedLeague)
  }

  function handleParticipantKicked(participantId: string): void {
    setParticipants((prev) => prev.filter((p) => p.id !== participantId))
  }

  function handleLeagueDeleted(): void {
    router.push('/dashboard')
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header className="mb-8">
        <Link
          href={`/league/${league.id}`}
          className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to League
        </Link>
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

        <DraftConfigSection
          league={league}
          participantCount={participants.length}
          isLocked={!isSetup}
          onUpdate={handleLeagueUpdate}
        />

        <ParticipantsSection
          league={league}
          participants={participants}
          currentUserId={currentUserId}
          isLocked={!isSetup}
          onKick={handleParticipantKicked}
        />

        <DangerZoneSection
          league={league}
          isLocked={!isSetup}
          onDelete={handleLeagueDeleted}
        />
      </div>
    </div>
  )
}
