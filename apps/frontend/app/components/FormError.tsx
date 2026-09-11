interface MessageProps {
  message?: string | null
}

/** @design-system Feedback */
export function FormError({ message }: MessageProps): React.ReactElement | null {
  if (!message) return null
  return <div className="alert alert-error" data-testid="form-error">{message}</div>
}

/** @design-system Feedback */
export function FormSuccess({ message }: MessageProps): React.ReactElement | null {
  if (!message) return null
  return <div className="alert alert-success" data-testid="form-success">{message}</div>
}

/** @design-system Feedback */
export function ErrorAlert({ message }: { message: string }): React.ReactElement {
  return (
    <div className="alert alert-error mb-4" data-testid="form-error">
      <p>{message}</p>
    </div>
  )
}
