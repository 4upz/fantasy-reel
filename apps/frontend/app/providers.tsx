'use client'

import { captureException } from '@/utils/sentry'
import { Toaster } from 'sonner'
import { SWRConfig } from 'swr'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
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
