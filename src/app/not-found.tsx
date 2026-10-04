import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">404</h1>
      <p className="mt-2 text-base text-gray-600">Page or resource not found.</p>
      {/* ARCHITECTURE RESET — honest surface label: / is the public school
          surface, not a "dashboard". No invented navigation claims. */}
      <Link
        href="/"
        className="mt-6 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
      >
        Return to home
      </Link>
    </div>
  )
}
