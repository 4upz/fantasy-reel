import Image from 'next/image'

interface BrandLogoProps {
  className?: string
  compact?: boolean
  markOnly?: boolean
}

/** Approved outlined artwork; text stays consistent without a font request. */
/** @design-system Identity & brand */
export default function BrandLogo({ className, compact = false, markOnly = false }: BrandLogoProps) {
  const darkAsset = markOnly ? 'mark-gold' : compact ? 'logo-compact-dark' : 'logo-dark'
  const lightAsset = markOnly ? 'mark-ink' : 'logo-light'

  return (
    <span className={`inline-block ${className ?? (markOnly ? 'h-auto w-7 shrink-0' : 'h-auto w-44 max-w-full')}`}>
      <Image
        src={`/brand/v1/${darkAsset}.svg`}
        alt="Fantasy Reel"
        width={markOnly ? 128 : compact ? 505 : 532}
        height={112}
        className="brand-logo-dark h-auto w-full"
        priority
        unoptimized
      />
      <Image
        src={`/brand/v1/${lightAsset}.svg`}
        alt="Fantasy Reel"
        width={markOnly ? 128 : 532}
        height={112}
        className="brand-logo-light h-auto w-full"
        priority
        unoptimized
      />
    </span>
  )
}
