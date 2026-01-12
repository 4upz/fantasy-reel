'use client'

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

export default function Avatar({ src, name, size = 'md', className = '' }: Props): React.ReactElement {
  const initial = name.charAt(0).toUpperCase()
  const sizeClass = sizeClasses[size]

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover border-2 border-gold ${className}`}
      />
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
