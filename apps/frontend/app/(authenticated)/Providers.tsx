'use client'

import { WishlistProvider } from '@/hooks/useWishlist'

export function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  return <WishlistProvider>{children}</WishlistProvider>
}
