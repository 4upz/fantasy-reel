import { useState, useCallback, useRef, useEffect } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'

export interface UserSearchResult {
  user_id: string
  display_name: string
  email_hint: string
  avatar_url: string | null
}

interface SearchUsersResponse {
  users: UserSearchResult[]
}

interface UseUserSearchOptions {
  leagueId: string
  debounceMs?: number
  minQueryLength?: number
}

interface UseUserSearchReturn {
  results: UserSearchResult[]
  loading: boolean
  error: string | null
  query: string
  search: (query: string) => void
  clear: () => void
}

export function useUserSearch({
  leagueId,
  debounceMs = 300,
  minQueryLength = 2,
}: UseUserSearchOptions): UseUserSearchReturn {
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isValidQuery = useCallback(
    (q: string) => q.trim().length >= minQueryLength,
    [minQueryLength]
  )

  const searchUsers = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim()
      if (!isValidQuery(trimmed)) {
        setResults([])
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const { data, error: apiError } = await callEdgeFunction<SearchUsersResponse>(
        'search-users',
        {
          body: {
            query: trimmed,
            league_id: leagueId,
            limit: 10,
          },
        }
      )

      if (apiError) {
        setError(apiError)
        setLoading(false)
        return
      }

      setResults(data?.users ?? [])
      setLoading(false)
    },
    [leagueId, isValidQuery]
  )

  const search = useCallback(
    (newQuery: string) => {
      setQuery(newQuery)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      if (!isValidQuery(newQuery)) {
        setResults([])
        setLoading(false)
        return
      }

      setLoading(true)
      debounceRef.current = setTimeout(() => {
        searchUsers(newQuery)
      }, debounceMs)
    },
    [searchUsers, debounceMs, isValidQuery]
  )

  const clear = useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)
    setLoading(false)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return {
    results,
    loading,
    error,
    query,
    search,
    clear,
  }
}
