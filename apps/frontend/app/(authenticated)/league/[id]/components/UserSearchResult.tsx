'use client'

import type { UserSearchResult } from '@/hooks/useUserSearch'

interface UserAvatarProps {
  avatarUrl: string | null
  displayName: string
  size?: 'sm' | 'md'
}

function UserAvatar({ avatarUrl, displayName, size = 'md' }: UserAvatarProps): React.ReactElement {
  const initial = displayName?.charAt(0).toUpperCase() || 'U'
  const sizeClasses = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className={`${sizeClasses} rounded-full object-cover border border-border`}
      />
    )
  }

  return (
    <div className={`${sizeClasses} rounded-full bg-elevated border border-border flex items-center justify-center font-medium text-foreground`}>
      {initial}
    </div>
  )
}

interface Props {
  user: UserSearchResult
  onSelect: (user: UserSearchResult) => void
  isHighlighted?: boolean
}

export default function UserSearchResultItem({ user, onSelect, isHighlighted }: Props): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        isHighlighted ? 'bg-surface-hover' : 'hover:bg-surface-hover'
      }`}
    >
      <UserAvatar avatarUrl={user.avatar_url} displayName={user.display_name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {user.display_name}
        </p>
        <p className="text-xs text-foreground-muted truncate">
          {user.email_hint}
        </p>
      </div>
    </button>
  )
}

interface SelectedUserChipProps {
  user: UserSearchResult
  onRemove: () => void
}

export function SelectedUserChip({ user, onRemove }: SelectedUserChipProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-elevated rounded-lg border border-border">
      <UserAvatar avatarUrl={user.avatar_url} displayName={user.display_name} size="sm" />
      <span className="text-sm font-medium text-foreground">
        {user.display_name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 p-0.5 rounded hover:bg-surface-hover text-foreground-muted hover:text-foreground transition-colors"
        aria-label="Remove selected user"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
