'use client'

import { useState, useRef, useEffect } from 'react'
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

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`

  return date.toLocaleDateString()
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refetch,
  } = useNotifications()

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleToggle = () => {
    if (!isOpen) {
      refetch()
    }
    setIsOpen(!isOpen)
  }

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id)
    }
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-lg hover:bg-surface-hover transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-5 h-5 text-foreground-secondary" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-crimson rounded-full flex items-center justify-center text-xs font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-hidden bg-surface border border-border rounded-lg shadow-heavy animate-fade-in z-50">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-border">
            <h3 className="font-display font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-gold hover:underline flex items-center gap-1"
              >
                <Check className="w-4 h-4" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
            {loading ? (
              <div className="p-4 text-center text-foreground-muted">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
                <p className="text-foreground-muted">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={() => handleNotificationClick(notification)}
                />
              ))
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
      className={`block p-3 hover:bg-surface-hover transition-colors border-b border-border last:border-b-0 ${
        isUnread ? 'bg-elevated/50' : ''
      }`}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-foreground-secondary'}`}>
            {notification.title}
          </p>
          <p className="text-xs text-foreground-muted mt-1 line-clamp-2">
            {notification.body}
          </p>
          <p className="text-xs text-foreground-muted mt-1">
            {formatTimeAgo(notification.created_at)}
          </p>
        </div>
        {isUnread && (
          <div className="flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-gold" />
          </div>
        )}
      </div>
    </Link>
  )
}
