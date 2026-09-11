'use client'

import { useCallback, useEffect, useRef } from 'react'

/** Native top-layer dialogs provide focus containment and make the page behind them inert. */
export function useModalDialog(onClose: () => void, preventClose = false) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  const preventCloseRef = useRef(preventClose)

  useEffect(() => {
    closeRef.current = onClose
    preventCloseRef.current = preventClose
  }, [onClose, preventClose])

  const requestClose = useCallback(() => {
    if (!preventCloseRef.current) closeRef.current()
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const handleCancel = (event: Event) => {
      event.preventDefault()
      requestClose()
    }
    dialog.addEventListener('cancel', handleCancel)
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus({ preventScroll: true })

    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [requestClose])

  return { dialogRef, requestClose }
}
