import type { ParticipantWithTeam } from '@/types'

interface Props {
  participants: ParticipantWithTeam[]
  ownerId: string
}

export default function ParticipantsList({ participants, ownerId }: Props) {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Participants</h2>
      {participants.length === 0 ? (
        <p className="text-gray-500">No participants yet</p>
      ) : (
        <div className="space-y-3">
          {participants.map((participant) => (
            <div key={participant.id} className="flex items-center p-3 bg-gray-50 rounded">
              <div className="flex-1">
                <p className="font-medium">{participant.teams?.name || 'No Team'}</p>
                <p className="text-sm text-gray-500">
                  Draft Order: {participant.draft_order}
                  {participant.user_id === ownerId && (
                    <span className="ml-2 text-indigo-600 font-medium">(Owner)</span>
                  )}
                </p>
              </div>
              <span
                className={`px-2 py-1 text-xs rounded-full ${
                  participant.role === 'owner'
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'bg-gray-100 text-gray-600'
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
