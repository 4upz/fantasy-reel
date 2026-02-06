interface MessageProps {
  message?: string | null
}

export function FormError({ message }: MessageProps): React.ReactElement | null {
  if (!message) return null
  return <div className="alert alert-error" data-testid="form-error">{message}</div>
}

export function FormSuccess({ message }: MessageProps): React.ReactElement | null {
  if (!message) return null
  return <div className="alert alert-success" data-testid="form-success">{message}</div>
}

export function ErrorAlert({ message }: { message: string }): React.ReactElement {
  return (
    <div className="alert alert-error mb-4" data-testid="form-error">
      <p>{message}</p>
    </div>
  )
}
