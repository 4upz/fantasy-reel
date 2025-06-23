export default function ErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Something went wrong
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            An error occurred during authentication. Please try again.
          </p>
        </div>
        <div className="text-center">
          <a
            href="/login"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Back to login
          </a>
        </div>
      </div>
    </div>
  )
}