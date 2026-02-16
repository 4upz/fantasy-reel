'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
interface Props {
  onCreateClick: () => void
}

export default function DashboardSidebar({ onCreateClick }: Props): React.ReactElement {
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState('')
  const [isJoining, setIsJoining] = useState(false)

  function handleJoinSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!inviteCode.trim()) return

    setIsJoining(true)
    router.push(`/join?token=${inviteCode.trim()}`)
  }

  return (
    <div className="space-y-4">
      {/* Browse Movies */}
      <Link href="/movies" className="sidebar-action-card flex items-center gap-3 cursor-pointer group">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-muted shrink-0">
          <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-display font-semibold text-foreground group-hover:text-gold transition-colors">
            Browse Movies
          </span>
          <p className="text-sm text-foreground-muted truncate">Discover upcoming releases</p>
        </div>
        <svg className="w-5 h-5 text-foreground-muted group-hover:text-gold transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {/* Create League */}
      <button
        onClick={onCreateClick}
        className="sidebar-action-card flex items-center gap-3 w-full text-left group"
        data-testid="create-league-button"
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-muted shrink-0">
          <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-display font-semibold text-foreground group-hover:text-gold transition-colors">
            Create League
          </span>
          <p className="text-sm text-foreground-muted truncate">Start a new fantasy league</p>
        </div>
        <svg className="w-5 h-5 text-foreground-muted group-hover:text-gold transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Join League */}
      <div className="sidebar-action-card">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-muted shrink-0">
            <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-display font-semibold text-foreground">Join a League</span>
            <p className="text-sm text-foreground-muted truncate">Enter invite code</p>
          </div>
        </div>
        <form onSubmit={handleJoinSubmit} className="flex gap-2">
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="Paste invite code"
            className="input flex-1 text-sm"
          />
          <button
            type="submit"
            disabled={!inviteCode.trim() || isJoining}
            className="btn btn-primary text-sm px-3"
          >
            {isJoining ? '...' : 'Join'}
          </button>
        </form>
      </div>

    </div>
  )
}
