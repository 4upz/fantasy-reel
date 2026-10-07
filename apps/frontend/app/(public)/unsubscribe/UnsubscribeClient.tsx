'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { MailX } from 'lucide-react'
import { FormError } from '../../components/FormError'
import NavLogo from '../../components/navigation/NavLogo'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { callEdgeFunction } from '@/utils/supabase/functions'

interface Props {
  token: string | null
}

/**
 * The footer link of season recap emails. It asks before unsubscribing, so a
 * mail scanner that opens every link can't turn anyone's emails off. (Mail
 * clients' own one-click button posts straight to the Edge Function.)
 */
export default function UnsubscribeClient({ token }: Props): React.ReactElement {
  const [done, setDone] = useState(false)
  const unsubscribe = useCallback(async () => {
    const { error } = await callEdgeFunction('email-unsubscribe', { body: { token } })
    if (error) throw new Error(error)
    setDone(true)
  }, [token])
  const { execute, isLoading, error } = useAsyncAction(unsubscribe)

  return (
    <div className="w-full max-w-md space-y-8 px-4">
      <div className="flex justify-center">
        <NavLogo href="/" />
      </div>

      <div className="card p-8 text-center animate-fade-in">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold-muted">
          <MailX className="h-6 w-6 text-gold" aria-hidden="true" />
        </div>

        {!token ? (
          <>
            <h1 className="type-panel text-foreground">This link is incomplete</h1>
            <p className="mt-3 text-foreground-secondary">
              Use the full unsubscribe link from the email, or turn season recaps off in your settings.
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="type-panel text-foreground" data-testid="unsubscribed-heading">
              You&apos;re unsubscribed
            </h1>
            <p className="mt-3 text-foreground-secondary">
              We won&apos;t email you final standings when a season ends. Emails about your trades, bids and
              invitations still arrive. You can turn season recaps back on in your settings.
            </p>
          </>
        ) : (
          <>
            <h1 className="type-panel text-foreground">Stop season recap emails?</h1>
            <p className="mt-3 text-foreground-secondary">
              These are the final standings emails we send when a season you played in ends.
            </p>
            <div className="mt-6 space-y-4 text-left">
              <FormError message={error} />
              <button
                type="button"
                onClick={() => execute()}
                disabled={isLoading}
                className="btn btn-primary w-full py-3"
                data-testid="unsubscribe-button"
              >
                {isLoading ? 'Unsubscribing...' : 'Unsubscribe'}
              </button>
            </div>
          </>
        )}

        <div className="mt-6">
          <Link href="/settings" className="text-gold hover:text-gold-hover font-semibold transition-colors">
            Email settings
          </Link>
        </div>
      </div>
    </div>
  )
}
