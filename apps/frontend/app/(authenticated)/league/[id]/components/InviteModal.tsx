'use client'

import { useState, useRef, useEffect, useId } from 'react'
import Modal from '@/app/components/Modal'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { announce } from '@/utils/announce'
import { useUserSearch, type UserSearchResult } from '@/hooks/useUserSearch'
import UserSearchResultItem, { SelectedUserChip } from './UserSearchResult'

interface Props {
  leagueId: string
  onClose: () => void
}

interface InviteResponse {
  invitation: {
    id: string
    // Null for invites by username: the server never reveals that address.
    email: string | null
    token: string
  }
  invite_url: string
  email_sent: boolean
  message: string
}

// Username invites name the person rather than the address the server used.
function inviteMessage(data: InviteResponse, displayName?: string): string {
  if (!displayName) return data.message || 'Invitation sent'
  return data.email_sent
    ? `Invitation sent to ${displayName}`
    : `Invitation created for ${displayName} (email delivery pending)`
}

type InviteMode = 'email' | 'username'

function getTabClassName(isActive: boolean): string {
  const base = 'flex-1 px-3 py-2 type-control rounded-md transition-colors cursor-pointer'
  return isActive
    ? `${base} bg-surface text-foreground shadow-soft`
    : `${base} text-foreground-secondary hover:text-foreground`
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
  const [copied, setCopied] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  // Where focus goes once the swap between search box and chosen user renders.
  const focusAfterSwap = useRef<'input' | 'submit' | null>(null)
  const titleId = useId()
  const searchId = useId()
  const searchHelpId = useId()
  const emailId = useId()
  const emailHelpId = useId()

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

  useEffect(() => {
    if (focusAfterSwap.current === 'input') inputRef.current?.focus()
    if (focusAfterSwap.current === 'submit') submitRef.current?.focus()
    focusAfterSwap.current = null
  }, [selectedUser])

  function handleModeChange(newMode: InviteMode): void {
    setMode(newMode)
    setResult(null)
    setEmail('')
    setSelectedUser(null)
    clearSearch()
  }

  function handleUserSelect(user: UserSearchResult): void {
    // The chosen result and the search box both leave; continue at Send.
    focusAfterSwap.current = 'submit'
    setSelectedUser(user)
    setShowDropdown(false)
    clearSearch()
    announce(`${user.display_name} selected`)
  }

  function handleRemoveUser(): void {
    focusAfterSwap.current = 'input'
    setSelectedUser(null)
  }

  async function handleInvite(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    if (!canSubmit) return

    setLoading(true)
    setResult(null)
    setCopied(false)

    const body = mode === 'email'
      ? { league_id: leagueId, email: email.trim() }
      : { league_id: leagueId, user_id: selectedUser!.user_id }

    const { data, error } = await callEdgeFunction<InviteResponse>('send-invite', { body })

    if (error) {
      setResult({ success: false, message: error })
    } else if (data) {
      setResult({
        success: true,
        message: inviteMessage(data, mode === 'username' ? selectedUser?.display_name : undefined),
        url: data.invite_url,
      })
      setEmail('')
      setSelectedUser(null)
    }

    setLoading(false)
  }

  // Toasts are hidden behind an open dialog, so copy feedback is spoken here
  // and shown on the button.
  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      announce('Invite link copied')
    } catch (err) {
      console.error('Failed to copy:', err)
      announce('Could not copy the invite link. Select the link and copy it instead.', 'assertive')
    }
  }

  const canSubmit = mode === 'email' ? email.trim().length > 0 : selectedUser !== null

  // What the results list holds, spoken as it settles: the list itself is a
  // set of buttons a screen-reader user would otherwise not know appeared.
  const searchStatus = mode !== 'username' || selectedUser || searchQuery.length < 2
    ? ''
    : searchLoading
      ? 'Searching…'
      : searchResults.length > 0
        ? `${searchResults.length} ${searchResults.length === 1 ? 'user' : 'users'} found`
        : 'No users found'

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="glass card p-6 w-full max-w-md animate-slide-up motion-reduce:animate-none">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 id={titleId} className="type-panel text-foreground">Invite players</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-foreground-secondary hover:text-foreground transition-colors"
            aria-label="Close invite players"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-elevated rounded-lg mb-4" role="group" aria-label="Invite by">
          <button
            type="button"
            onClick={() => handleModeChange('username')}
            aria-pressed={mode === 'username'}
            className={getTabClassName(mode === 'username')}
          >
            By username
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('email')}
            aria-pressed={mode === 'email'}
            className={getTabClassName(mode === 'email')}
          >
            By email
          </button>
        </div>

        <form onSubmit={handleInvite}>
          {/* Username search (typeahead) */}
          {mode === 'username' && (
            <div className="mb-4">
              {selectedUser ? (
                <>
                  <p className="type-label block text-foreground-secondary mb-1">Selected user</p>
                  <SelectedUserChip user={selectedUser} onRemove={handleRemoveUser} />
                </>
              ) : (
                <>
                  <label htmlFor={searchId} className="type-label block text-foreground-secondary mb-1">
                    Search users
                  </label>
                  <div className="relative" ref={dropdownRef}>
                    <input
                      ref={inputRef}
                      id={searchId}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => search(e.target.value)}
                      onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                      onKeyDown={(e) => {
                        // Escape closes the results first; a second one closes the dialog.
                        if (e.key === 'Escape' && showDropdown) {
                          e.preventDefault()
                          setShowDropdown(false)
                        }
                      }}
                      placeholder="Search by name..."
                      className="input"
                      autoComplete="off"
                      aria-describedby={searchHelpId}
                    />

                    {/* Loading indicator */}
                    {searchLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true">
                        <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}

                    {/* Dropdown */}
                    {showDropdown && (
                      <div className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-lg shadow-heavy overflow-hidden">
                        {searchResults.length > 0 ? (
                          <ul className="max-h-60 overflow-y-auto" role="list" aria-label="Matching users">
                            {searchResults.map((user) => (
                              <li key={user.user_id}>
                                <UserSearchResultItem
                                  user={user}
                                  onSelect={handleUserSelect}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : searchQuery.length >= 2 && !searchLoading ? (
                          <div className="type-body-sm px-3 py-4 text-center text-foreground-secondary">
                            No users found
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              )}

              <p className="sr-only" role="status">{searchStatus}</p>

              {searchError && (
                <p className="type-body-sm mt-1 text-error" role="alert">{searchError}</p>
              )}

              <p id={searchHelpId} className="type-meta mt-1 text-foreground-secondary">
                Search for existing users to invite them directly
              </p>
            </div>
          )}

          {/* Email input */}
          {mode === 'email' && (
            <div className="mb-4">
              <label htmlFor={emailId} className="type-label block text-foreground-secondary mb-1">
                Email address
              </label>
              <input
                type="email"
                id={emailId}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="player@example.com"
                className="input"
                autoComplete="email"
                aria-describedby={emailHelpId}
                required
              />
              <p id={emailHelpId} className="type-meta mt-1 text-foreground-secondary">
                Send an invite link to any email address
              </p>
            </div>
          )}

          {/* Result message */}
          {result && (
            <div
              className={`mb-4 ${result.success ? 'alert alert-success' : 'alert alert-error'}`}
              role={result.success ? 'status' : 'alert'}
            >
              <p>{result.message}</p>
              {result.url && (
                <div className="mt-2">
                  <p className="type-meta mb-1" aria-hidden="true">Invite link:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={result.url}
                      readOnly
                      aria-label="Invite link"
                      className="type-meta flex-1 p-2 bg-surface border border-border rounded text-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(result.url!)}
                      className="type-meta btn btn-primary px-2 py-1"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              ref={submitRef}
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
    </Modal>
  )
}
