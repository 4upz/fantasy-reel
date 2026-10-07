'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Bell } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { updateSeasonRecapEmails } from '../actions'

interface Props {
  seasonRecapEmails: boolean
}

export default function EmailPreferences({ seasonRecapEmails }: Props): React.ReactElement {
  const [enabled, setEnabled] = useState(seasonRecapEmails)

  const save = useCallback(async (next: boolean) => {
    const result = await updateSeasonRecapEmails(next)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to save your email preference')
      return
    }
    setEnabled(next)
    toast.success(next ? 'Season recap emails turned on' : 'Season recap emails turned off')
  }, [])
  const { execute, isLoading } = useAsyncAction(save)

  return (
    <section className="card p-6" aria-labelledby="email-preferences-heading">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
        <div className="p-2 rounded-lg bg-surface-hover">
          <Bell className="w-5 h-5 text-foreground-secondary" aria-hidden="true" />
        </div>
        <div>
          <h2 id="email-preferences-heading" className="type-section text-foreground">
            Email
          </h2>
          <p className="type-body-sm text-foreground-secondary">Choose which optional emails you get</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="season-recap-label" className="type-label text-foreground">Season recaps</p>
          <p id="season-recap-description" className="type-meta text-foreground-secondary mt-0.5">
            Final standings when a season you played in ends. Emails about your invitations, bids and trades
            always arrive.
          </p>
        </div>
        <button
          type="button"
          onClick={() => execute(!enabled)}
          // aria-disabled rather than disabled: disabling the focused switch
          // would drop keyboard focus to the page while the change saves.
          aria-disabled={isLoading || undefined}
          className={`relative w-10 h-6 shrink-0 cursor-pointer rounded-full transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60 ${
            enabled ? 'bg-gold' : 'bg-elevated border border-border'
          }`}
          role="switch"
          aria-checked={enabled}
          aria-labelledby="season-recap-label"
          aria-describedby="season-recap-description"
          data-testid="season-recap-toggle"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${
              enabled ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>
    </section>
  )
}
