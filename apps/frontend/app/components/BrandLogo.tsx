import Image from 'next/image'

interface BrandLogoProps {
  className?: string
  compact?: boolean
  markOnly?: boolean
}

/** Approved outlined artwork; text stays consistent without a font request. */
/** @design-system Identity & brand */
export default function BrandLogo({ className, compact = false, markOnly = false }: BrandLogoProps) {
  const asset = markOnly ? 'mark-gold' : compact ? 'logo-compact-dark' : 'logo-dark'

  return (
    <Image
      src={`/brand/v1/${asset}.svg`}
      alt="Fantasy Reel"
      width={markOnly ? 128 : compact ? 505 : 532}
      height={112}
      className={className ?? (markOnly ? 'h-auto w-7 shrink-0' : 'h-auto w-44 max-w-full')}
      priority
      unoptimized
    />
  )
}
