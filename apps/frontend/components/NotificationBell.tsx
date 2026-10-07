'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Check,
  Clapperboard,
  DollarSign,
  Gift,
  TrendingDown,
  Trophy,
} from 'lucide-react'
import Link from 'next/link'
import { useNotifications } from '@/hooks/useNotifications'
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss'
import { announce } from '@/utils/announce'
import type { Notification, NotificationType } from '@/types'

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'outbid':
      return <AlertTriangle className="w-4 h-4 text-warning" />
    case 'bid_won':
      return <DollarSign className="w-4 h-4 text-success" />
    case 'bid_lost':
      return <TrendingDown className="w-4 h-4 text-error" />
    case 'pickup_available':
      return <Gift className="w-4 h-4 text-gold" />
    case 'season_completed':
      return <Trophy className="w-4 h-4 text-gold" />
    case 'season_started':
      return <Clapperboard className="w-4 h-4 text-gold" />
    default:
      return <Bell className="w-4 h-4 text-foreground-muted" />
  }
}

const TIME_UNITS = [
  { unit: 'day', seconds: 86400, abbreviation: 'd' },
  { unit: 'hour', seconds: 3600, abbreviation: 'h' },
  { unit: 'minute', seconds: 60, abbreviation: 'm' },
] as const

const relativeTime = new Intl.RelativeTimeFormat('en')

/** "5m ago" to show, and "5 minutes ago" for screen readers, which read the short form as "5 m". */
function formatTimeAgo(dateString: string): { short: string; spoken: string } {
  const date = new Date(dateString)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 60) return { short: 'Just now', spoken: 'Just now' }
  if (seconds >= 604800) {
    const day = date.toLocaleDateString()
    return { short: day, spoken: day }
  }

  const { unit, seconds: unitSeconds, abbreviation } =
    TIME_UNITS.find(candidate => seconds >= candidate.seconds) ?? TIME_UNITS[2]
  const count = Math.floor(seconds / unitSeconds)
  return { short: `${count}${abbreviation} ago`, spoken: relativeTime.format(-count, unit) }
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const markingAllRead = useRef(false)
  const panelId = useId()

  const {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    refetch,
  } = useNotifications()

  const close = useCallback(() => {
    markingAllRead.current = false
    setIsOpen(false)
  }, [])

  usePopoverDismiss(isOpen, close, dropdownRef, triggerRef)

  // "Mark all read" unmounts itself once nothing is unread, so move focus to
  // the panel heading and confirm. A failed update leaves the button in place.
  useEffect(() => {
    if (!markingAllRead.current || unreadCount > 0) return
    markingAllRead.current = false
    headingRef.current?.focus()
    announce('All notifications marked as read')
  }, [unreadCount])

  const handleToggle = () => {
    if (isOpen) {
      close()
    } else {
      refetch()
      setIsOpen(true)
    }
  }

  const handleMarkAllRead = () => {
    markingAllRead.current = true
    void markAllAsRead()
  }

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id)
    }
    close()
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="relative p-2 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <Bell className="w-5 h-5 text-foreground-secondary" />
        {unreadCount > 0 && (
          <span className="type-numeric absolute -top-1 -right-1 w-5 h-5 bg-crimson rounded-full flex items-center justify-center text-xs font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id={panelId}
          className="absolute right-0 mt-2 flex max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden bg-surface border border-border rounded-lg shadow-heavy animate-fade-in z-50"
        >
          {/* Header */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 p-3 border-b border-border">
            <h2 ref={headingRef} tabIndex={-1} className="type-panel text-foreground focus:outline-none">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="type-control text-gold hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div role="status" className="p-4 text-center text-foreground-secondary">Loading...</div>
            ) : error && notifications.length === 0 ? (
              <p role="alert" className="p-4 text-center text-error">
                Couldn&apos;t load notifications. Please try again later.
              </p>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
                <p className="text-foreground-secondary">No notifications yet</p>
              </div>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <li key={notification.id} className="border-b border-border last:border-b-0">
                    <NotificationItem
                      notification={notification}
                      onClick={() => handleNotificationClick(notification)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface NotificationItemProps {
  notification: Notification
  onClick: () => void
}

function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const isUnread = !notification.read_at
  const timeAgo = formatTimeAgo(notification.created_at)
  const leagueId = notification.league_id
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Data contains additional info like tmdb_id and bid_id for future use
  const data = notification.data as { tmdb_id?: number; bid_id?: string } | null

  // Determine link based on notification type
  let href = leagueId ? `/league/${leagueId}` : '/dashboard'
  if (notification.type === 'outbid' && leagueId) {
    href = `/league/${leagueId}?tab=bidding`
  } else if (notification.type === 'bid_won' && leagueId) {
    href = `/league/${leagueId}/roster`
  } else if (notification.type === 'season_completed' && leagueId) {
    href = `/league/${leagueId}/standings`
  } else if (notification.type === 'season_started' && leagueId) {
    // The row carries the NEW season's league id, so this lands on the season
    // that just opened rather than the one that ended.
    href = `/league/${leagueId}/dashboard`
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block p-3 hover:bg-surface-hover transition-colors ${
        isUnread ? 'bg-elevated/50' : ''
      }`}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-foreground-secondary'}`}>
            {/* Unread is otherwise shown only by weight, tint and a dot. */}
            {isUnread && <span className="sr-only">Unread: </span>}
            {notification.title}
          </p>
          <p className="type-meta text-foreground-secondary mt-1 line-clamp-2">
            {notification.body}
          </p>
          <p className="type-meta text-foreground-secondary mt-1">
            <time dateTime={notification.created_at}>
              <span aria-hidden="true">{timeAgo.short}</span>
              <span className="sr-only">{timeAgo.spoken}</span>
            </time>
          </p>
        </div>
        {isUnread && (
          <div className="flex-shrink-0" aria-hidden="true">
            <div className="w-2 h-2 rounded-full bg-gold" />
          </div>
        )}
      </div>
    </Link>
  )
}
