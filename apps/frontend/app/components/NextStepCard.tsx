'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Clapperboard, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { captureException } from '@/utils/sentry'
import { announce } from '@/utils/announce'
import { NEXT_STEP_PREF_KEY, type NextStep } from '@/utils/onboarding'

interface Props {
  step: NextStep
  userId: string
  /** Where focus goes once the card hides itself, taking its button along. */
  onHidden?: () => void
}

interface Copy {
  title: string
  body: string
  action: { label: string; href: string }
  secondary?: { label: string; href: string }
}

function copyFor(step: NextStep): Copy {
  const league = `/league/${step.leagueId}`
  switch (step.kind) {
    case 'draft-live':
      return step.counterpicking
        ? {
            title: `Counterpicks are underway in ${step.leagueName}`,
            body: 'Each team bets against another team’s movie and scores its points in reverse. The draft room shows whose turn it is.',
            action: { label: 'Go to the draft', href: `${league}/draft` },
          }
        : {
            title: `The ${step.leagueName} draft is live`,
            body: 'Teams take turns picking upcoming movies. The draft room shows whose turn it is and counts the picks until yours.',
            action: { label: 'Go to the draft', href: `${league}/draft` },
          }
    case 'setup-owner':
      return {
        title: `Get ${step.leagueName} ready to draft`,
        body: 'Invite at least one more player, check the rules in Settings, then start the draft. Players can join until it starts.',
        action: { label: 'Open league', href: `${league}/draft` },
      }
    case 'setup-member':
      return {
        title: `${step.leagueName} hasn’t drafted yet`,
        body: 'The commissioner starts the draft once everyone’s in. Meanwhile, tap the heart on movies you like to build a wishlist you can draft from.',
        action: { label: 'Browse movies', href: '/movies' },
        secondary: { label: 'Open league', href: `${league}/draft` },
      }
  }
}

/**
 * The dashboard's answer to "what do I do now?" for a player who hasn't played
 * a season yet: one line naming their next move in the league that needs it
 * most, and a link to the page where that league's tour picks up. Derived from
 * memberships on every load, so it is never out of date; hiding it is the only
 * thing stored (`prefs:next-step`).
 */
/** @design-system Dashboard */
export default function NextStepCard({ step, userId, onHidden }: Props): React.ReactElement | null {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  const copy = copyFor(step)

  function hide(): void {
    setHidden(true)
    announce('Next steps hidden.')
    onHidden?.()
    void createClient()
      .from('user_ui_state')
      .upsert({ user_id: userId, key: NEXT_STEP_PREF_KEY, value: { hidden: true } }, { onConflict: 'user_id,key' })
      .then(({ error }) => {
        // Hidden for this visit either way; it comes back on the next load.
        if (error) captureException(error, { tags: { source: 'next-step' } })
      })
  }

  return (
    <section
      className="card animate-slide-up mb-6 flex items-start gap-3 border-l-2 border-l-gold p-5"
      aria-labelledby="next-step-title"
      data-testid="next-step"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gold-muted">
        <Clapperboard className="h-5 w-5 text-gold" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="type-label text-gold">Next step</p>
        <h2 id="next-step-title" className="type-card text-foreground mt-0.5">
          {copy.title}
        </h2>
        <p className="type-body-sm text-foreground-secondary mt-1">{copy.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={copy.action.href} className="btn btn-primary" data-testid="next-step-action">
            {copy.action.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {copy.secondary && (
            <Link href={copy.secondary.href} className="type-control text-gold transition-colors hover:text-gold-hover">
              {copy.secondary.label}
            </Link>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={hide}
        aria-label="Hide next steps"
        className="flex-none cursor-pointer p-1 text-foreground-secondary transition-colors hover:text-foreground"
        data-testid="next-step-hide"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  )
}
