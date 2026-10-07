'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False in the server HTML and during hydration, true once React is attached.
 *
 * Forms that submit through `onSubmit` (rather than a React form action) must
 * disable their submit button until this is true: before hydration the browser
 * would submit natively, as a GET that puts every field - passwords included -
 * in the URL.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
