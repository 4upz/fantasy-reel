'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Closes a non-modal disclosure panel (a trigger button plus the panel it
 * shows) the ways keyboard and pointer users expect: a press outside
 * `containerRef`, Escape (which also returns focus to `triggerRef`, since the
 * focused item in the panel is about to unmount), and Tab moving focus out of
 * the container, so the panel never lingers over the page.
 */
export function usePopoverDismiss(
  isOpen: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const container = containerRef.current
    if (!isOpen || !container) return

    function handlePointerDown(event: MouseEvent) {
      if (!container?.contains(event.target as Node)) close()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }

    function handleFocusOut(event: FocusEvent) {
      // A null target means focus went nowhere in particular (a click on
      // plain text, the window losing focus); the pointer handler covers clicks.
      const next = event.relatedTarget as Node | null
      if (next && !container?.contains(next)) close()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    container.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('focusout', handleFocusOut)
    }
  }, [isOpen, close, containerRef, triggerRef])
}
