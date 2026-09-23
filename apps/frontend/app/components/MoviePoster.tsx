'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Film } from 'lucide-react'
import { getTmdbPosterUrl, type TmdbPosterSize } from '@/utils/movie-posters'

interface Props {
  src: string | null | undefined
  alt: string
  sizes: string
  /** Image styling; the caller supplies a positioned container with fixed dimensions. */
  className?: string
  posterSize?: TmdbPosterSize
  priority?: boolean
}

/** Shared loading and recovery behavior for posters in any sized container. */
export default function MoviePoster({ src, posterSize = 'w500', ...props }: Props) {
  const source = getTmdbPosterUrl(src, posterSize)
  // A refreshed URL gets a fresh attempt, even if the previous poster failed.
  return <PosterImage key={source} src={source} {...props} />
}

function PosterImage({ src, alt, sizes, className = '', priority = false }: Omit<Props, 'posterSize'>) {
  const [attempt, setAttempt] = useState<'optimized' | 'direct' | 'failed'>('optimized')
  const [loaded, setLoaded] = useState(false)

  if (!src || attempt === 'failed') {
    return (
      <span
        className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-elevated"
        role={alt ? 'img' : undefined}
        aria-label={alt ? `${alt} poster unavailable` : undefined}
        aria-hidden={alt ? undefined : true}
        data-testid="movie-poster-fallback"
      >
        <Film className="h-auto w-1/3 max-w-12 text-foreground-muted" aria-hidden="true" />
      </span>
    )
  }

  return (
    <>
      {!loaded && (
        <span
          className="pointer-events-none absolute inset-0 animate-shimmer rounded-[inherit] bg-elevated motion-reduce:animate-none"
          aria-hidden="true"
          data-testid="movie-poster-loading"
        />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={attempt === 'direct'}
        className={`object-cover ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false)
          // A failed optimizer request can still have a healthy TMDb original.
          // Try that URL once; a missing upstream file ends at the placeholder.
          setAttempt(attempt === 'optimized' && src.startsWith('https://image.tmdb.org/t/p/')
            ? 'direct'
            : 'failed')
        }}
      />
    </>
  )
}
