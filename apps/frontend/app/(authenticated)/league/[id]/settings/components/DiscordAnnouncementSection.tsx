'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Megaphone } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, describedBy } from './shared'

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
  const charsOver = charCount - MAX_MESSAGE_LENGTH
  const isOverLimit = charsOver > 0
  const isSubmitDisabled = isLoading || isOverLimit || !message.trim()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    // A failure is already in `error`, shown and announced below the field.
    const result = await execute(leagueId, message.trim()).catch(() => undefined)
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
            className="type-label block text-foreground-secondary mb-2"
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
            aria-invalid={isOverLimit || undefined}
            aria-describedby={describedBy(
              'announcement_message_help',
              'announcement_message_count',
              isOverLimit && 'announcement_message_error'
            )}
          />
          <div className="flex justify-between mt-2">
            <p id="announcement_message_help" className="type-meta text-foreground-secondary">
              Sent as an embed to every linked channel, regardless of their notification settings
            </p>
            <span
              id="announcement_message_count"
              className={`type-numeric type-meta ${isOverLimit ? 'text-error' : 'text-foreground-secondary'}`}
            >
              <span aria-hidden="true">{charCount}/{MAX_MESSAGE_LENGTH}</span>
              <span className="sr-only">{charCount} of {MAX_MESSAGE_LENGTH} characters</span>
            </span>
          </div>
          {/* The red border and counter, in words. */}
          {isOverLimit && (
            <p id="announcement_message_error" role="alert" className="type-meta text-error mt-1">
              The message is {charsOver} {charsOver === 1 ? 'character' : 'characters'} too long.
            </p>
          )}
        </div>

        {error && <p role="alert" className="type-body-sm text-error mb-4">{error}</p>}

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
