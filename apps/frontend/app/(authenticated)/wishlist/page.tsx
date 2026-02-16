import { getCachedUser } from '@/utils/supabase/cached'
import { redirect } from 'next/navigation'
import WishlistClient from './WishlistClient'

export const metadata = {
  title: 'Wishlist | Fantasy Reel',
}

export default async function WishlistPage() {
  const {
    data: { user },
  } = await getCachedUser()
  if (!user) redirect('/login')

  return <WishlistClient userId={user.id} />
}
