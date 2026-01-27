'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { Link2, Copy, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { League, GenerateJoinLinkResponse } from '@/types'
import { ButtonSpinner } from '../../components/Icons'
import { SectionHeader, LockedMessage } from './shared'

interface Props {
  league: League
  isLocked: boolean
  onUpdate: (league: League) => void
}

export default function JoinLinkSection({
  league,
  isLocked,
  onUpdate,
}: Props): React.ReactElement {
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)

  const copiedCodeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const copiedUrlTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (copiedCodeTimeoutRef.current) clearTimeout(copiedCodeTimeoutRef.current)
      if (copiedUrlTimeoutRef.current) clearTimeout(copiedUrlTimeoutRef.current)
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
      // Update the league with the new join_code
      onUpdate({
        ...league,
        join_code: data.join_code,
        join_token: data.join_token,
      })
      toast.success(hasJoinLink ? 'Join link regenerated' : 'Join link generated')
      setShowRegenerateConfirm(false)
    }
  }, [league, onUpdate, hasJoinLink])

  const { execute: generateLink, isLoading: isGenerating } = useAsyncAction(generateAction)

  async function copyToClipboard(text: string, type: 'code' | 'url'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'code') {
        setCopiedCode(true)
        if (copiedCodeTimeoutRef.current) clearTimeout(copiedCodeTimeoutRef.current)
        copiedCodeTimeoutRef.current = setTimeout(() => setCopiedCode(false), 2000)
      } else {
        setCopiedUrl(true)
        if (copiedUrlTimeoutRef.current) clearTimeout(copiedUrlTimeoutRef.current)
        copiedUrlTimeoutRef.current = setTimeout(() => setCopiedUrl(false), 2000)
      }
      toast.success(`${type === 'code' ? 'Join code' : 'Join link'} copied to clipboard`)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  function handleGenerateClick(): void {
    if (hasJoinLink) {
      setShowRegenerateConfirm(true)
    } else {
      generateLink()
    }
  }

  return (
    <section className="card p-6">
      <SectionHeader
        icon={Link2}
        title="Shareable Join Link"
        description={isLocked ? 'Unavailable after draft starts' : 'Invite anyone with a single link'}
        isLocked={isLocked}
      />

      {isLocked ? (
        <LockedMessage message="Join links are disabled once the draft has started. New members cannot join after drafting begins." />
      ) : (
        <div className="space-y-6">
          {hasJoinLink ? (
            <>
              {/* Join Code Display */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-3">
                  Join Code
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <div className="bg-elevated border border-border rounded-lg px-4 py-3 font-mono text-2xl font-bold tracking-[0.3em] text-gold text-center select-all">
                      {joinCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(joinCode!, 'code')}
                    className="btn btn-secondary h-[52px] px-4"
                    title="Copy code"
                  >
                    {copiedCode ? (
                      <Check className="w-5 h-5 text-success" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-foreground-muted mt-2">
                  Share this code directly - members can enter it at fantasyreel.com/join
                </p>
              </div>

              {/* Full URL Display */}
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-3">
                  Full Link
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      readOnly
                      value={joinUrl}
                      className="input w-full pr-4 text-sm text-foreground-secondary truncate cursor-text"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(joinUrl, 'url')}
                    className="btn btn-secondary h-[42px] px-4"
                    title="Copy link"
                  >
                    {copiedUrl ? (
                      <Check className="w-5 h-5 text-success" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-foreground-muted mt-2">
                  One-click join - anyone with this link can join your league instantly
                </p>
              </div>

              {/* Regenerate Section */}
              <div className="pt-4 border-t border-border">
                {showRegenerateConfirm ? (
                  <div className="bg-warning-bg/50 border border-warning/30 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground mb-1">
                          Regenerate join link?
                        </p>
                        <p className="text-xs text-foreground-secondary mb-3">
                          The current code will stop working immediately. Anyone who already has the old link won&apos;t be able to use it.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => generateLink()}
                            disabled={isGenerating}
                            className="btn btn-danger text-sm py-1.5 px-3"
                          >
                            {isGenerating ? (
                              <>
                                <ButtonSpinner variant="danger" />
                                Regenerating...
                              </>
                            ) : (
                              'Yes, regenerate'
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRegenerateConfirm(false)}
                            disabled={isGenerating}
                            className="btn btn-ghost text-sm py-1.5 px-3"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateClick}
                    disabled={isGenerating}
                    className="btn btn-ghost text-foreground-secondary hover:text-foreground"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerate link
                  </button>
                )}
              </div>
            </>
          ) : (
            /* No join link yet - show generate button */
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gold/10 mb-4">
                <Link2 className="w-8 h-8 text-gold" />
              </div>
              <h3 className="text-lg font-display font-semibold text-foreground mb-2">
                No join link yet
              </h3>
              <p className="text-sm text-foreground-secondary mb-6 max-w-md mx-auto">
                Generate a shareable link that anyone can use to join your league.
                Unlike email invites, this link can be shared anywhere and used by multiple people.
              </p>
              <button
                type="button"
                onClick={() => generateLink()}
                disabled={isGenerating}
                className="btn btn-primary"
              >
                {isGenerating ? (
                  <>
                    <ButtonSpinner />
                    Generating...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4 mr-2" />
                    Generate Join Link
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
