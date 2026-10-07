'use client'

import { useModalDialog } from '@/hooks/useModalDialog'

interface Props extends Omit<React.DialogHTMLAttributes<HTMLDialogElement>, 'onClose' | 'open'> {
  /** Called on Escape, a backdrop click, or a close button calling it. */
  onClose: () => void
  /** Ignore Escape and backdrop clicks, e.g. while a request is in flight. */
  preventClose?: boolean
  /** Id of the dialog's visible heading - every dialog needs a name. */
  labelledBy: string
  /** Id of the text that explains the dialog (optional). */
  describedBy?: string
  /** Close when the dimmed area around it is clicked. Off by default so a stray click cannot discard a form; turn it on for read-only views. */
  closeOnBackdrop?: boolean
  children: React.ReactNode
}

/**
 * A modal dialog on the native <dialog> element.
 *
 * Mount it when it should be open (`{open && <Modal …>}`). showModal() puts it
 * in the top layer, makes the rest of the page inert for screen readers and
 * keyboards, and traps Tab; Escape closes it and focus returns to whatever
 * opened it. Put `data-dialog-initial-focus` on an element to focus it first.
 *
 * Children render the panel; the dialog itself is the full-screen backdrop
 * area that centers it.
 *
 * @design-system Modals
 */
export default function Modal({
  onClose,
  preventClose = false,
  labelledBy,
  describedBy,
  closeOnBackdrop = false,
  className = '',
  children,
  ...rest
}: Props): React.ReactElement {
  const { dialogRef } = useModalDialog(onClose, preventClose, closeOnBackdrop)

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal="true"
      className={`modal-dialog ${className}`}
      {...rest}
    >
      {children}
    </dialog>
  )
}
