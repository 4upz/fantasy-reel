interface MessageProps {
  message?: string | null
}

export function FormError({ message }: MessageProps): React.ReactElement | null {
  if (!message) return null
  return (
    <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-md text-sm">
      {message}
    </div>
  )
}

export function FormSuccess({ message }: MessageProps): React.ReactElement | null {
  if (!message) return null
  return (
    <div className="bg-green-50 border border-green-200 text-green-600 p-3 rounded-md text-sm">
      {message}
    </div>
  )
}

export function ErrorAlert({ message }: { message: string }): React.ReactElement {
  return (
    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
      <p className="text-sm text-red-600">{message}</p>
    </div>
  )
}
