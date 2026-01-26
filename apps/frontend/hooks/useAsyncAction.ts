import { useRef, useState, useCallback } from 'react'

interface UseAsyncActionResult<TArgs extends unknown[], TReturn> {
  execute: (...args: TArgs) => Promise<TReturn | undefined>
  isLoading: boolean
  error: string | null
  reset: () => void
}

/**
 * Hook for protecting async actions from double-click race conditions.
 *
 * Uses a ref for synchronous, immediate protection against rapid clicks,
 * combined with state for UI updates (loading, error).
 *
 * @example
 * ```tsx
 * const { execute, isLoading, error } = useAsyncAction(async (movieId: string) => {
 *   await draftPick(movieId)
 * })
 *
 * <button onClick={() => execute(movie.id)} disabled={isLoading}>
 *   Draft
 * </button>
 * ```
 */
export function useAsyncAction<TArgs extends unknown[], TReturn>(
  action: (...args: TArgs) => Promise<TReturn>
): UseAsyncActionResult<TArgs, TReturn> {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isProcessingRef = useRef(false)

  const execute = useCallback(
    async (...args: TArgs): Promise<TReturn | undefined> => {
      // Synchronous ref check - immediate protection against double-clicks
      if (isProcessingRef.current) return undefined
      isProcessingRef.current = true

      setIsLoading(true)
      setError(null)

      try {
        const result = await action(...args)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        setError(message)
        throw err
      } finally {
        isProcessingRef.current = false
        setIsLoading(false)
      }
    },
    [action]
  )

  const reset = useCallback(() => {
    setError(null)
  }, [])

  return { execute, isLoading, error, reset }
}
