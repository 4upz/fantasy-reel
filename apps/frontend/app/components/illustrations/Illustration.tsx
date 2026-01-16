import { type ReactNode } from 'react'

export type IllustrationSize = 'sm' | 'md' | 'lg'

interface IllustrationProps {
  size?: IllustrationSize
  alt: string
  className?: string
  children: ReactNode
}

const sizeClasses: Record<IllustrationSize, string> = {
  sm: 'h-[120px] w-auto',
  md: 'h-[200px] w-auto',
  lg: 'h-[280px] w-auto',
}

export default function Illustration({
  size = 'md',
  alt,
  className = '',
  children,
}: IllustrationProps): React.ReactElement {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`flex items-center justify-center ${sizeClasses[size]} ${className}`}
    >
      {children}
    </div>
  )
}
