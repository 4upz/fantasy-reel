interface Props {
  message?: string
  size?: 'sm' | 'md'
}

export function LoadingSpinner({ message, size = 'sm' }: Props): React.ReactElement {
  const sizeClass = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'

  return (
    <div className="text-center py-4">
      <div
        className={`inline-block animate-spin rounded-full ${sizeClass} border-b-2 border-gold`}
      ></div>
      {message && <p className="mt-2 text-sm text-foreground-secondary">{message}</p>}
    </div>
  )
}
