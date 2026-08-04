'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Megaphone } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader } from './shared'

interface Props {
  leagueId: string
}

const MAX_MESSAGE_LENGTH = 1500

interface SendAnnouncementResponse {
  message: string
  channels_notified: number
}

async function postAnnouncement(leagueId: string, message: string): Promise<SendAnnouncementResponse> {
  const { data, error } = await callEdgeFunction<SendAnnouncementResponse>('send-announcement', {
    body: { league_id: leagueId, message },
  })
  if (error) throw new Error(error)
  if (!data) throw new Error('No response from server')
  return data
}

export default function DiscordAnnouncementSection({ leagueId }: Props): React.ReactElement {
  const [message, setMessage] = useState('')
  const { execute, isLoading, error } = useAsyncAction(postAnnouncement)

  const charCount = message.length
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH
  const isSubmitDisabled = isLoading || isOverLimit || !message.trim()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    const result = await execute(leagueId, message.trim())
    if (!result) return

    if (result.channels_notified > 0) {
      toast.success(
        `Posted to ${result.channels_notified} Discord ${result.channels_notified === 1 ? 'channel' : 'channels'}`
      )
      setMessage('')
    } else {
      toast.info('No Discord channels are linked to this league yet')
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Megaphone}
        title="Commissioner Announcement"
        description="Post a message to every Discord channel linked to this league"
      />

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label
            htmlFor="announcement_message"
            className="block text-sm font-medium text-foreground-secondary mb-2"
          >
            Message
          </label>
          <textarea
            id="announcement_message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Draft trade deadline is Friday -- get your business in before then."
            rows={4}
            className={`input resize-none ${isOverLimit ? 'border-error focus:border-error focus:shadow-[0_0_0_3px_var(--color-error-bg)]' : ''}`}
            maxLength={MAX_MESSAGE_LENGTH + 100}
          />
          <div className="flex justify-between mt-2">
            <p className="text-xs text-foreground-muted">
              Sent as an embed to every linked channel, regardless of their notification settings
            </p>
            <span className={`text-xs ${isOverLimit ? 'text-error' : 'text-foreground-muted'}`}>
              {charCount}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
        </div>

        {error && <p className="text-sm text-error mb-4">{error}</p>}

        <button type="submit" disabled={isSubmitDisabled} className="btn btn-primary">
          {isLoading ? (
            <>
              <ButtonSpinner />
              Posting...
            </>
          ) : (
            'Post to Discord'
          )}
        </button>
      </form>
    </section>
  )
}
