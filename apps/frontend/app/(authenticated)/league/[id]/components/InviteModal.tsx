'use client'

import { useState, useRef, useEffect } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useUserSearch, type UserSearchResult } from '@/hooks/useUserSearch'
import UserSearchResultItem, { SelectedUserChip } from './UserSearchResult'

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

type InviteMode = 'email' | 'username'

function getTabClassName(isActive: boolean): string {
  const base = 'flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors'
  return isActive
    ? `${base} bg-surface text-foreground shadow-soft`
    : `${base} text-foreground-muted hover:text-foreground`
}

export default function InviteModal({ leagueId, onClose }: Props): React.ReactElement {
  const [mode, setMode] = useState<InviteMode>('username')
  const [email, setEmail] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message: string
    url?: string
  } | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    results: searchResults,
    loading: searchLoading,
    error: searchError,
    query: searchQuery,
    search,
    clear: clearSearch,
  } = useUserSearch({ leagueId })

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Show dropdown when there are results
  useEffect(() => {
    if (searchResults.length > 0 && searchQuery.length >= 2) {
      setShowDropdown(true)
    }
  }, [searchResults, searchQuery])

  function handleModeChange(newMode: InviteMode): void {
    setMode(newMode)
    setResult(null)
    setEmail('')
    setSelectedUser(null)
    clearSearch()
  }

  function handleUserSelect(user: UserSearchResult): void {
    setSelectedUser(user)
    setShowDropdown(false)
    clearSearch()
  }

  function handleRemoveUser(): void {
    setSelectedUser(null)
    inputRef.current?.focus()
  }

  async function handleInvite(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    if (!canSubmit) return

    setLoading(true)
    setResult(null)

    const body = mode === 'email'
      ? { league_id: leagueId, email: email.trim() }
      : { league_id: leagueId, user_id: selectedUser!.user_id }

    const { data, error } = await callEdgeFunction<InviteResponse>('send-invite', { body })

    if (error) {
      setResult({ success: false, message: error })
    } else if (data) {
      setResult({
        success: true,
        message: data.message || 'Invitation sent',
        url: data.invite_url,
      })
      setEmail('')
      setSelectedUser(null)
    }

    setLoading(false)
  }

  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const canSubmit = mode === 'email' ? email.trim().length > 0 : selectedUser !== null

  return (
    <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
      <div className="glass card p-6 w-full max-w-md animate-slide-up">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold font-display text-foreground">Invite Players</h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-elevated rounded-lg mb-4">
          <button
            type="button"
            onClick={() => handleModeChange('username')}
            className={getTabClassName(mode === 'username')}
          >
            By Username
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('email')}
            className={getTabClassName(mode === 'email')}
          >
            By Email
          </button>
        </div>

        <form onSubmit={handleInvite}>
          {/* Username search (typeahead) */}
          {mode === 'username' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Search Users
              </label>

              {selectedUser ? (
                <SelectedUserChip user={selectedUser} onRemove={handleRemoveUser} />
              ) : (
                <div className="relative" ref={dropdownRef}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => search(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    placeholder="Search by name..."
                    className="input"
                    autoComplete="off"
                  />

                  {/* Loading indicator */}
                  {searchLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}

                  {/* Dropdown */}
                  {showDropdown && (
                    <div className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-lg shadow-heavy overflow-hidden">
                      {searchResults.length > 0 ? (
                        <div className="max-h-60 overflow-y-auto">
                          {searchResults.map((user) => (
                            <UserSearchResultItem
                              key={user.user_id}
                              user={user}
                              onSelect={handleUserSelect}
                            />
                          ))}
                        </div>
                      ) : searchQuery.length >= 2 && !searchLoading ? (
                        <div className="px-3 py-4 text-center text-sm text-foreground-muted">
                          No users found
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {searchError && (
                <p className="mt-1 text-sm text-error">{searchError}</p>
              )}

              <p className="mt-1 text-xs text-foreground-muted">
                Search for existing users to invite them directly
              </p>
            </div>
          )}

          {/* Email input */}
          {mode === 'email' && (
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
              <p className="mt-1 text-xs text-foreground-muted">
                Send an invite link to any email address
              </p>
            </div>
          )}

          {/* Result message */}
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

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading || !canSubmit}
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
