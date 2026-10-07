'use client'

import Image from 'next/image'
import { safeAvatarUrl } from '@/utils/avatar'

interface Props {
  src: string | null | undefined
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /**
   * The name is already written next to the avatar, so hide it from screen
   * readers instead of reading the name twice.
   */
  decorative?: boolean
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-9 h-9 text-base',
  lg: 'w-24 h-24 text-3xl',
} as const

const imageSizes = {
  sm: 32,
  md: 36,
  lg: 96,
} as const

/** @design-system Foundation */
export default function Avatar({ src, name, size = 'md', className = '', decorative = false }: Props): React.ReactElement {
  const initial = name.charAt(0).toUpperCase()
  const sizeClass = sizeClasses[size]
  const imageSize = imageSizes[size]
  const safeSrc = safeAvatarUrl(src)

  if (safeSrc) {
    return (
      <div className={`${sizeClass} relative rounded-full overflow-hidden border-2 border-gold ${className}`}>
        <Image
          src={safeSrc}
          alt={decorative ? '' : name}
          width={imageSize}
          height={imageSize}
          className="object-cover"
          unoptimized
        />
      </div>
    )
  }

  return (
    <div
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={`${sizeClass} rounded-full bg-gold-muted border-2 border-gold flex items-center justify-center ${className}`}
    >
      <span aria-hidden="true" className="font-body font-semibold text-gold">{initial}</span>
    </div>
  )
}
