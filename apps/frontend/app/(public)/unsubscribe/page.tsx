import type { Metadata } from 'next'
import UnsubscribeClient from './UnsubscribeClient'

export const metadata: Metadata = {
  title: 'Unsubscribe | Fantasy Reel',
  robots: { index: false },
  // The token in the URL is a credential; don't hand it to anything linked from here.
  referrer: 'no-referrer',
}

interface Props {
  searchParams: Promise<{ token?: string | string[] }>
}

export default async function UnsubscribePage({ searchParams }: Props): Promise<React.ReactElement> {
  const { token } = await searchParams
  return <UnsubscribeClient token={typeof token === 'string' ? token : null} />
}
