'use client'

import Image from 'next/image'

interface Props {
  src: string | null | undefined
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
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

export default function Avatar({ src, name, size = 'md', className = '' }: Props): React.ReactElement {
  const initial = name.charAt(0).toUpperCase()
  const sizeClass = sizeClasses[size]
  const imageSize = imageSizes[size]

  if (src) {
    return (
      <div className={`${sizeClass} relative rounded-full overflow-hidden border-2 border-gold ${className}`}>
        <Image
          src={src}
          alt={name}
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
      className={`${sizeClass} rounded-full bg-gold-muted border-2 border-gold flex items-center justify-center ${className}`}
    >
      <span className="font-display font-bold text-gold">{initial}</span>
    </div>
  )
}
