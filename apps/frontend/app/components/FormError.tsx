export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-md text-sm">
      {message}
    </div>
  )
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="bg-green-50 border border-green-200 text-green-600 p-3 rounded-md text-sm">
      {message}
    </div>
  )
}
