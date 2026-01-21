'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Clock, DollarSign, X, AlertTriangle } from 'lucide-react'
import type { PickupBid } from '@/types'

interface BidCardProps {
  bid: PickupBid
  isOwner: boolean
  onCancel?: () => void
  onCounter?: () => void
}

function formatTimeRemaining(deadline: string | null): string {
  if (!deadline) return 'Processing soon'

  const now = new Date()
  const end = new Date(deadline)
  const diff = end.getTime() - now.getTime()

  if (diff <= 0) return 'Processing soon'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  return `${hours}h ${minutes}m`
}

export default function BidCard({ bid, isOwner, onCancel, onCounter }: BidCardProps) {
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)

  const movieData = bid.movie_data as {
    title?: string
    poster_url?: string
    release_date?: string
  } | null

  const isOutbid = bid.status === 'outbid'
  const deadline = isOutbid ? bid.response_deadline : bid.processing_deadline

  return (
    <div className={`card p-4 ${isOutbid ? 'border-warning bg-warning-bg/20' : ''}`}>
      <div className="flex gap-4">
        {/* Movie Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded overflow-hidden bg-elevated">
          {movieData?.poster_url ? (
            <Image
              src={`https://image.tmdb.org/t/p/w92${movieData.poster_url}`}
              alt={movieData.title || 'Movie poster'}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-foreground-muted">
              No poster
            </div>
          )}
        </div>

        {/* Bid Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground truncate">
            {movieData?.title || `Movie #${bid.tmdb_id}`}
          </h4>

          {movieData?.release_date && (
            <p className="text-sm text-foreground-secondary">
              {new Date(movieData.release_date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}

          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1 text-gold font-semibold">
              <DollarSign className="w-4 h-4" />
              <span>{bid.amount}</span>
            </div>

            <div className="flex items-center gap-1 text-foreground-secondary text-sm">
              <Clock className="w-4 h-4" />
              <span>{formatTimeRemaining(deadline)}</span>
            </div>
          </div>

          {isOutbid && (
            <div className="flex items-center gap-1 mt-2 text-warning text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>You&apos;ve been outbid!</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {isOwner && (
          <div className="flex flex-col gap-2">
            {isOutbid && onCounter && (
              <button
                onClick={onCounter}
                className="btn btn-primary text-sm py-1 px-3"
              >
                Counter
              </button>
            )}

            {bid.status === 'active' && (
              isConfirmingCancel ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      onCancel?.()
                      setIsConfirmingCancel(false)
                    }}
                    className="btn btn-danger text-xs py-1 px-2"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setIsConfirmingCancel(false)}
                    className="btn btn-ghost text-xs py-1 px-2"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsConfirmingCancel(true)}
                  className="btn btn-ghost text-sm py-1 px-2"
                  title="Cancel bid"
                >
                  <X className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
