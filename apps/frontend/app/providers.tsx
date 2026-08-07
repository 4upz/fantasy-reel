'use client'

import * as Sentry from '@sentry/nextjs'
import { Toaster } from 'sonner'
import { SWRConfig } from 'swr'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        onError: (err: Error, key: string) => {
          Sentry.captureException(err, { tags: { source: 'swr' }, extra: { key } })
        },
      }}
    >
      {children}
      <Toaster position="top-right" richColors />
    </SWRConfig>
  )
}
