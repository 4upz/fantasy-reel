interface Props {
  message?: string
  size?: 'sm' | 'md'
}

/** @design-system Foundation */
export function LoadingSpinner({ message, size = 'sm' }: Props): React.ReactElement {
  const sizeClass = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'

  return (
    <div role="status" className="text-center py-4">
      <div
        aria-hidden="true"
        className={`inline-block animate-spin rounded-full ${sizeClass} border-b-2 border-gold`}
      ></div>
      {message ? (
        <p className="type-body-sm mt-2 text-foreground-secondary">{message}</p>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  )
}
