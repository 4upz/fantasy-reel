'use client'

import { useState, useCallback } from 'react'
import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import { useWishlist } from '@/hooks/useWishlist'
import type { TMDbSearchResult } from '@/types'

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

interface WishlistToggleProps {
  movie: TMDbSearchResult
  size?: 'sm' | 'md'
  variant?: 'overlay' | 'inline'
  className?: string
}

const sizeStyles = {
  sm: { button: 'p-1.5', icon: 'w-4 h-4' },
  md: { button: 'p-2', icon: 'w-5 h-5' },
} as const

export function WishlistToggle({
  movie,
  size = 'sm',
  variant = 'overlay',
  className,
}: WishlistToggleProps) {
  const { isWishlisted, toggleWishlist } = useWishlist()
  const [animation, setAnimation] = useState<'pop' | 'shrink' | null>(null)

  const wishlisted = isWishlisted(movie.tmdb_id)

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()

      const willBeWishlisted = !wishlisted

      // Trigger animation
      setAnimation(willBeWishlisted ? 'pop' : 'shrink')
      const duration = willBeWishlisted ? 300 : 200
      setTimeout(() => setAnimation(null), duration)

      toggleWishlist(movie)

      if (willBeWishlisted) {
        toast('Added to Wishlist', {
          action: {
            label: 'View',
            onClick: () => {
              window.location.href = '/wishlist'
            },
          },
        })
      }
    },
    [wishlisted, movie, toggleWishlist]
  )

  function getAnimationClass(): string {
    switch (animation) {
      case 'pop': return 'animate-heart-pop'
      case 'shrink': return 'animate-heart-shrink'
      default: return ''
    }
  }

  function getVariantClass(): string {
    if (variant === 'overlay') {
      return wishlisted
        ? 'bg-crimson text-white'
        : 'bg-background/60 backdrop-blur-sm text-foreground-muted hover:text-crimson hover:bg-background/80'
    }
    return wishlisted
      ? 'text-crimson'
      : 'text-foreground-muted hover:text-crimson'
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={wishlisted}
      aria-label={`Wishlist ${movie.title}`}
      className={cn(
        'rounded-full transition-colors cursor-pointer',
        sizeStyles[size].button,
        getVariantClass(),
        getAnimationClass(),
        className
      )}
    >
      <Heart
        className={sizeStyles[size].icon}
        fill={wishlisted ? 'currentColor' : 'none'}
        strokeWidth={wishlisted ? 0 : 2}
      />
    </button>
  )
}
