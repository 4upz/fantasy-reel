'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { Link2, Copy, Check, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { League, GenerateJoinLinkResponse } from '@/types'

interface Props {
  league: League
  onUpdate: (league: League) => void
}

export default function JoinLinkCard({ league, onUpdate }: Props): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [showFullUrl, setShowFullUrl] = useState(false)

  const copiedTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
    }
  }, [])

  const joinCode = league.join_code
  const hasJoinLink = !!joinCode

  // Build the join URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fantasyreel.com'
  const joinUrl = hasJoinLink ? `${appUrl}/join?code=${joinCode}` : ''

  const generateAction = useCallback(async () => {
    const { data, error } = await callEdgeFunction<GenerateJoinLinkResponse>(
      'generate-join-link',
      { body: { league_id: league.id } }
    )

    if (error) {
      throw new Error(error)
    }

    if (data) {
      onUpdate({
        ...league,
        join_code: data.join_code,
        join_token: data.join_token,
      })
      toast.success(hasJoinLink ? 'Join link regenerated' : 'Join link generated')
    }
  }, [league, onUpdate, hasJoinLink])

  const { execute: generateLink, isLoading: isGenerating } = useAsyncAction(generateAction)

  async function copyToClipboard(): Promise<void> {
    const textToCopy = showFullUrl ? joinUrl : joinCode!
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
      toast.success(`${showFullUrl ? 'Join link' : 'Join code'} copied`)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="card p-4" data-testid="join-link-card">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-gold/10">
          <Link2 className="w-4 h-4 text-gold" />
        </div>
        <h3 className="font-display font-semibold text-foreground">Share Join Link</h3>
      </div>

      {hasJoinLink ? (
        <div className="space-y-3">
          {/* Join Code Display */}
          <div
            onClick={copyToClipboard}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                copyToClipboard()
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={showFullUrl ? 'Copy join link to clipboard' : 'Copy join code to clipboard'}
            className="bg-elevated border border-border rounded-lg px-3 py-2.5 cursor-pointer hover:border-gold/50 transition-colors group focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50"
          >
            <div className="flex items-center justify-between">
              {showFullUrl ? (
                <span className="text-sm text-foreground-secondary truncate pr-2 flex-1" data-testid="join-link-url">
                  {joinUrl}
                </span>
              ) : (
                <span className="font-mono text-lg font-bold tracking-[0.25em] text-gold" data-testid="join-code-display">
                  {joinCode}
                </span>
              )}
              <div className="flex items-center gap-1" data-testid="copy-join-link-button">
                {copied ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4 text-foreground-muted group-hover:text-gold transition-colors" />
                )}
              </div>
            </div>
          </div>

          {/* Toggle and Regenerate */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowFullUrl(!showFullUrl)}
              className="text-xs text-foreground-muted hover:text-foreground-secondary flex items-center gap-1 transition-colors"
            >
              {showFullUrl ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Show code
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Show full URL
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => generateLink()}
              disabled={isGenerating}
              className="text-xs text-foreground-muted hover:text-foreground-secondary flex items-center gap-1 transition-colors disabled:opacity-50"
              data-testid="regenerate-join-link-button"
            >
              <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>

          <p className="text-xs text-foreground-muted">
            Anyone with this link can join your league
          </p>
        </div>
      ) : (
        <div className="text-center py-2">
          <p className="text-sm text-foreground-secondary mb-3">
            Create a shareable link for anyone to join
          </p>
          <button
            type="button"
            onClick={() => generateLink()}
            disabled={isGenerating}
            className="btn btn-secondary text-sm py-2 px-4"
            data-testid="generate-join-link-button"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 mr-2" />
                Generate Link
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
