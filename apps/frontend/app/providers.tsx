'use client'

import { captureException } from '@/utils/sentry'
import { Toaster } from 'sonner'
import { SWRConfig } from 'swr'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        // Nothing in this app changes just because the tab regained focus, and
        // the movie data behind most keys is billed per TMDb call.
        revalidateOnFocus: false,
        onError: (err: Error, key: string) => {
          captureException(err, { tags: { source: 'swr' }, extra: { key } })
        },
      }}
    >
      {children}
      <Toaster position="top-right" richColors />
    </SWRConfig>
  )
}
