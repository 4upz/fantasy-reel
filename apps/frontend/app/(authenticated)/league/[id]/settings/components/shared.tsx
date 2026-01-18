'use client'

import type { LucideIcon } from 'lucide-react'
import { Lock } from 'lucide-react'

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  description: string
  isLocked?: boolean
}

/**
 * Consistent header for settings sections with icon, title, and description
 */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  isLocked = false,
}: SectionHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
      <div className={`p-2 rounded-lg ${isLocked ? 'bg-surface-hover' : 'bg-gold/10'}`}>
        {isLocked ? (
          <Lock className="w-5 h-5 text-foreground-muted" />
        ) : (
          <Icon className="w-5 h-5 text-gold" />
        )}
      </div>
      <div>
        <h2 className="text-lg font-display font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-sm text-foreground-muted">
          {description}
        </p>
      </div>
    </div>
  )
}

interface LockedMessageProps {
  message: string
}

/**
 * Consistent locked state message box for settings sections
 */
export function LockedMessage({ message }: LockedMessageProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 p-4 bg-surface-hover rounded-lg border border-border">
      <Lock className="w-5 h-5 text-foreground-muted shrink-0" />
      <p className="text-sm text-foreground-secondary">{message}</p>
    </div>
  )
}
