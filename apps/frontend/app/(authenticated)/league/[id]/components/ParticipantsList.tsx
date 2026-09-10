'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ParticipantWithProfile } from '@/types'

interface Props {
  participants: ParticipantWithProfile[]
  ownerId: string
}

export default function ParticipantsList({ participants, ownerId }: Props): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="card p-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="type-section text-foreground">
          Participants ({participants.length})
        </h2>
        <ChevronDown
          className={`h-5 w-5 text-foreground-muted transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[1000px] opacity-100 mt-4' : 'max-h-0 opacity-0'
        }`}
      >
        {participants.length === 0 ? (
          <p className="text-foreground-secondary">No participants yet</p>
        ) : (
          <div className="space-y-3">
            {participants.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center p-3 bg-elevated rounded-lg border border-border"
              >
                <div className="flex-1">
                  <p className="type-row-title text-foreground">{participant.teams?.name || 'No Team'}</p>
                  {participant.profiles?.display_name && (
                    <p className="type-meta text-foreground-secondary">{participant.profiles.display_name}</p>
                  )}
                  <p className="type-body-sm text-foreground-secondary">
                    Draft Order: {participant.draft_order}
                    {participant.user_id === ownerId && (
                      <span className="ml-2 text-gold font-medium">(Owner)</span>
                    )}
                  </p>
                </div>
                <span
                  className={`badge ${
                    participant.role === 'owner' ? 'bg-gold-muted text-gold' : 'bg-elevated text-foreground-secondary'
                  }`}
                >
                  {participant.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
