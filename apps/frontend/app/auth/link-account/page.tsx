import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import LinkAccountClient from './LinkAccountClient'

interface LinkAccountContext {
  duplicateUserId: string
  email: string
  discordUsername: string
  discordIdentityId?: string
}

export default async function LinkAccountPage() {
  const cookieStore = await cookies()
  const contextCookie = cookieStore.get('link_account_context')

  if (!contextCookie?.value) {
    // No context - redirect to login
    redirect('/login')
  }

  let context: LinkAccountContext
  try {
    context = JSON.parse(contextCookie.value)
  } catch {
    // Invalid context - redirect to login
    redirect('/login')
  }

  if (!context.email || !context.duplicateUserId) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <LinkAccountClient
        email={context.email}
        discordUsername={context.discordUsername}
        duplicateUserId={context.duplicateUserId}
      />
    </div>
  )
}
