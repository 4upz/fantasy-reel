'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  label: string
  detail: string
  isMyTurn: boolean
  unavailable?: boolean
}

/** Keep turn context visible above mobile navigation while browsing long lists. */
export default function DraftTurnStatus({ label, detail, isMyTurn, unavailable }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(
    <>
    <div className="fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 rounded-xl border border-border bg-surface/95 p-3 shadow-heavy backdrop-blur-md lg:hidden" role="status" aria-live="polite" data-testid="mobile-draft-turn">
      <p className={`type-label truncate ${unavailable ? 'text-error' : isMyTurn ? 'text-success' : 'text-foreground'}`}>
        {unavailable ? 'Draft updates unavailable' : label}
      </p>
      <p className="type-meta text-foreground-secondary truncate">{unavailable ? 'Retry updates before making a pick.' : detail}</p>
    </div>
    {/* Document-end space keeps the global footer reachable above both bars. */}
    <div className="h-[calc(176px+env(safe-area-inset-bottom))] lg:hidden" aria-hidden="true" />
    </>, document.body,
  )
}
