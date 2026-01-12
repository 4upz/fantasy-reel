'use client'

import { useState } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'

interface Props {
  leagueId: string
  onClose: () => void
}

interface InviteResponse {
  invitation: {
    id: string
    email: string
    token: string
  }
  invite_url: string
  message: string
}

export default function InviteModal({ leagueId, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message: string
    url?: string
  } | null>(null)

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) return

    setLoading(true)
    setResult(null)

    const { data, error } = await callEdgeFunction<InviteResponse>('send-invite', {
      body: { league_id: leagueId, email: email.trim() },
    })

    if (error) {
      setResult({ success: false, message: error })
    } else if (data) {
      setResult({
        success: true,
        message: data.message || `Invitation sent to ${email}`,
        url: data.invite_url,
      })
      setEmail('')
    }

    setLoading(false)
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
      <div className="glass card p-6 w-full max-w-md animate-slide-up">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold font-display text-foreground">Invite Players</h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleInvite}>
          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-foreground-secondary mb-1">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="player@example.com"
              className="input"
              required
            />
          </div>

          {result && (
            <div className={`mb-4 ${result.success ? 'alert alert-success' : 'alert alert-error'}`}>
              <p>{result.message}</p>
              {result.url && (
                <div className="mt-2">
                  <p className="text-xs font-medium mb-1">Invite Link:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={result.url}
                      readOnly
                      className="flex-1 text-xs p-2 bg-surface border border-border rounded text-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(result.url!)}
                      className="btn btn-primary text-xs px-2 py-1"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="btn btn-primary flex-1"
            >
              {loading ? 'Sending...' : 'Send Invite'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-ghost px-4">
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
