import { useEffect, useRef, useCallback, type RefObject } from 'react'

interface UseInfiniteScrollOptions {
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  rootMargin?: string
}

export function useInfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = '200px',
}: UseInfiniteScrollOptions): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries
      if (entry.isIntersecting && hasMore && !isLoading) {
        onLoadMore()
      }
    },
    [hasMore, isLoading, onLoadMore]
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin,
    })

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  }, [handleIntersect, rootMargin])

  return sentinelRef
}
