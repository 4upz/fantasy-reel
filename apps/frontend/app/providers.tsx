'use client'

import { captureException } from '@/utils/sentry'
import { Toaster } from 'sonner'
import { SWRConfig } from 'swr'
import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider'

function ThemeToaster() {
  const { resolvedTheme } = useTheme()
  return <Toaster position="top-right" richColors theme={resolvedTheme} />
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SWRConfig
        value={{
          // Nothing in this app changes just because the tab regained focus, and
          // the movie data behind most keys is billed per TMDb call.
          revalidateOnFocus: false,
          // Same key inside a minute is answered from cache, so a remounting
          // component (draft board, bid modal, movie dialog) costs nothing.
          // Hooks override this only where the data is even more static.
          dedupingInterval: 60_000,
          // SWR's default keeps retrying a failing key for as long as the
          // component is mounted. Three attempts is plenty: the Edge Functions
          // already retry TMDb and fall back to stale cache server-side.
          errorRetryCount: 3,
          onError: (err: Error, key: string) => {
            captureException(err, { tags: { source: 'swr' }, extra: { key } })
          },
        }}
      >
        {children}
        <ThemeToaster />
      </SWRConfig>
    </ThemeProvider>
  )
}
