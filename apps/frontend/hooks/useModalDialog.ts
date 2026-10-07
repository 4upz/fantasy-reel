'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Native top-layer dialogs provide focus containment and make the page behind them inert.
 *
 * Escape calls `onClose` unless `preventClose` is set (e.g. while a request is
 * in flight). A click on the backdrop closes only with `closeOnBackdrop`: off
 * by default, because a stray click should not throw away a half-filled form.
 * The backdrop is anything that lands on the <dialog> element itself rather
 * than on its content, so give the dialog no padding of its own where a click
 * should not close it.
 */
export function useModalDialog(onClose: () => void, preventClose = false, closeOnBackdrop = false) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  const preventCloseRef = useRef(preventClose)
  const closeOnBackdropRef = useRef(closeOnBackdrop)

  useEffect(() => {
    closeRef.current = onClose
    preventCloseRef.current = preventClose
    closeOnBackdropRef.current = closeOnBackdrop
  }, [onClose, preventClose, closeOnBackdrop])

  const requestClose = useCallback(() => {
    if (!preventCloseRef.current) closeRef.current()
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    // Set once React has been asked to unmount the dialog, so the native
    // `close` that follows is not mistaken for one the browser forced.
    let closing = false

    const handleCancel = (event: Event) => {
      event.preventDefault()
      if (preventCloseRef.current) return
      closing = true
      closeRef.current()
    }
    // Browsers honour preventDefault() on `cancel` only once per user
    // activation, so a second Escape would close the dialog natively. While
    // closing is blocked, cancel the key itself so no close request is made.
    // Listen on the document: a control disabled mid-request drops focus to
    // <body>, outside the dialog.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && preventCloseRef.current) event.preventDefault()
    }
    // Backstop for any close the guards above did not stop: reopen while
    // closing is blocked, otherwise let React unmount it so state stays in sync.
    // `close` is dispatched asynchronously, so one queued by an earlier
    // cleanup (React's dev double-mount) can arrive after showModal() has
    // reopened the dialog; that one is stale and ignored.
    const handleClose = () => {
      if (closing || dialog.open) return
      if (preventCloseRef.current) {
        dialog.showModal()
      } else {
        closing = true
        closeRef.current()
      }
    }
    // A drag or text selection that ends over the backdrop also fires a click
    // there; only close when the press started on the backdrop too.
    let pressedBackdrop = false
    const handlePointerDown = (event: PointerEvent) => {
      pressedBackdrop = event.target === dialog
    }
    const handleClick = (event: MouseEvent) => {
      if (closeOnBackdropRef.current && pressedBackdrop && event.target === dialog) requestClose()
      pressedBackdrop = false
    }

    dialog.addEventListener('cancel', handleCancel)
    document.addEventListener('keydown', handleKeyDown, true)
    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('pointerdown', handlePointerDown)
    dialog.addEventListener('click', handleClick)
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus({ preventScroll: true })

    return () => {
      closing = true
      dialog.removeEventListener('cancel', handleCancel)
      document.removeEventListener('keydown', handleKeyDown, true)
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('pointerdown', handlePointerDown)
      dialog.removeEventListener('click', handleClick)
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [requestClose])

  return { dialogRef, requestClose }
}
