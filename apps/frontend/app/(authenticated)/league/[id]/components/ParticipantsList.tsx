import type { ParticipantWithProfile } from '@/types'

interface Props {
  participants: ParticipantWithProfile[]
  ownerId: string
}

export default function ParticipantsList({ participants, ownerId }: Props) {
  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold font-display text-foreground mb-4">Participants</h2>
      {participants.length === 0 ? (
        <p className="text-foreground-muted">No participants yet</p>
      ) : (
        <div className="space-y-3">
          {participants.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center p-3 bg-elevated rounded-lg border border-border"
            >
              <div className="flex-1">
                <p className="font-medium text-foreground">{participant.teams?.name || 'No Team'}</p>
                {participant.profiles?.display_name && (
                  <p className="text-xs text-foreground-muted">{participant.profiles.display_name}</p>
                )}
                <p className="text-sm text-foreground-muted">
                  Draft Order: {participant.draft_order}
                  {participant.user_id === ownerId && (
                    <span className="ml-2 text-gold font-medium">(Owner)</span>
                  )}
                </p>
              </div>
              <span
                className={`badge ${
                  participant.role === 'owner' ? 'bg-gold-muted text-gold' : 'bg-elevated text-foreground-muted'
                }`}
              >
                {participant.role}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
