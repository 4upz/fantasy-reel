interface MessageProps {
  message?: string | null
  /** Lets a field point `aria-describedby` at the message. */
  id?: string
  /**
   * Pass a ref to move focus to the message, e.g. after the control that was
   * focused unmounts. A focused message is read on focus, so it drops its live
   * role rather than being read twice.
   */
  ref?: React.Ref<HTMLDivElement>
  /**
   * Whether the message announces itself as it appears (default true). Pass
   * false when focus moves to a field it describes, which reads it instead.
   */
  announce?: boolean
}

function Message({
  message,
  id,
  ref,
  announce = true,
  role,
  tone,
  testId,
}: MessageProps & { role: 'alert' | 'status'; tone: string; testId: string }): React.ReactElement | null {
  if (!message) return null
  const live = announce && !ref
  // The key remounts the message when it becomes live, so it arrives as a new
  // live region and is announced instead of gaining the role after its text.
  return (
    <div
      key={live ? 'live' : 'quiet'}
      role={live ? role : undefined}
      id={id}
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      className={`alert ${tone} focus:outline-none`}
      data-testid={testId}
    >
      {message}
    </div>
  )
}

/** @design-system Feedback */
export function FormError(props: MessageProps): React.ReactElement | null {
  return <Message {...props} role="alert" tone="alert-error" testId="form-error" />
}

/** @design-system Feedback */
export function FormSuccess(props: MessageProps): React.ReactElement | null {
  return <Message {...props} role="status" tone="alert-success" testId="form-success" />
}

/**
 * Field props linking a control to its help text (`describedBy`) and, when
 * the form error is about this field, marking it invalid and linking the
 * FormError rendered with `errorId` too.
 */
export function fieldErrorProps(invalid: boolean, errorId: string, ...describedBy: string[]) {
  const ids = invalid ? [...describedBy, errorId] : describedBy
  return {
    'aria-invalid': invalid || undefined,
    'aria-describedby': ids.length ? ids.join(' ') : undefined,
  }
}

/** @design-system Feedback */
export function ErrorAlert({ message }: { message: string }): React.ReactElement {
  return (
    <div role="alert" className="alert alert-error mb-4" data-testid="form-error">
      <p>{message}</p>
    </div>
  )
}
