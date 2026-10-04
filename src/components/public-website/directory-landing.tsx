'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Building2, GraduationCap, MapPin, Users } from 'lucide-react'

/**
 * ARCHITECTURE RESET — the SCHOLARIO directory landing.
 *
 * Rendered at the bare deployment domain when NO tenant resolves (multi-
 * tenant DB without a demo default) or when an explicit slug fails. This is
 * a PLATFORM surface: the deployment domain is not silently any school's
 * website — each school's public site is an EXPLICIT link (`/?slug=…`).
 *
 * Design: neutral premium light SaaS (white canvas, slate text, hairline
 * borders, restrained teal accent). No gradients, no glassmorphism, no
 * decorative orbs, no invented marketing copy — only the real public
 * directory from /api/public/directory.
 */

export interface DirectorySchool {
  slug: string
  name: string
  shortName: string | null
  city: string | null
  board: string | null
  themeColor: string
  logoUrl: string | null
  established: string | null
  students: number
}

interface DirectoryLandingProps {
  /** Small "school portal sign-in" door (SPA state switch — school surface). */
  onOpenPortal?: () => void
  /** Honest notice when an explicitly requested slug did not resolve. */
  notFoundForSlug?: string | null
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function SchoolCard({ school }: { school: DirectorySchool }) {
  const initials = initialsOf(school.shortName || school.name)
  const location = [school.city, school.board].filter(Boolean).join(' · ')
  return (
    <a
      href={`/?slug=${encodeURIComponent(school.slug)}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
      aria-label={`Visit the ${school.name} website`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: school.themeColor || '#0f766e' }}
          aria-hidden="true"
        >
          {initials}
        </div>
        {school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logoUrl}
            alt={`${school.name} logo`}
            className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 object-contain bg-white p-1"
          />
        ) : null}
      </div>
      <h3 className="mt-4 text-base font-semibold leading-snug text-slate-900 group-hover:text-teal-700">
        {school.name}
      </h3>
      {location ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate">{location}</span>
        </p>
      ) : null}
      {school.students > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>{school.students.toLocaleString()} students</span>
        </p>
      ) : null}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-teal-700">
        Visit website
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </a>
  )
}

export function DirectoryLanding({ onOpenPortal, notFoundForSlug }: DirectoryLandingProps) {
  const [schools, setSchools] = useState<DirectorySchool[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/public/directory')
        const isJson = res.headers.get('content-type')?.includes('application/json')
        const json = isJson ? await res.json().catch(() => null) : null
        if (!alive) return
        if (res.ok && json?.success && Array.isArray(json?.data?.schools)) {
          setSchools(json.data.schools as DirectorySchool[])
        } else {
          setFailed(true)
        }
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Header — SCHOLARIO platform brand */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white" aria-hidden="true">
              <GraduationCap className="h-4.5 w-4.5" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight">SCHOLARIO</span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
                School platform
              </span>
            </div>
          </div>
          <a
            href="/platform/login"
            className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            Platform sign-in
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Schools on this platform
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            Public websites of schools running on Scholario. Each school is a separate
            tenant with its own website, branding, and login portal.
          </p>
        </div>

        {notFoundForSlug ? (
          <div
            role="status"
            className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            No school was found for{' '}
            <span className="font-semibold">“{notFoundForSlug}”</span>.
          </div>
        ) : null}

        {/* Directory */}
        <section aria-label="School directory" className="mt-10">
          {schools === null && !failed ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <div className="h-11 w-11 rounded-lg bg-slate-200" />
                  <div className="mt-4 h-4 w-3/4 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : null}

          {failed ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              The school directory could not be loaded. Please refresh to try again.
            </div>
          ) : null}

          {schools && schools.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
              <Building2 className="mx-auto mb-3 h-6 w-6 text-slate-400" aria-hidden="true" />
              No public school websites are available yet.
            </div>
          ) : null}

          {schools && schools.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {schools.map((school) => (
                <SchoolCard key={school.slug} school={school} />
              ))}
            </div>
          ) : null}
        </section>
      </main>

      {/* Footer — sticky to bottom on short content */}
      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} SCHOLARIO</span>
          {onOpenPortal ? (
            <button
              type="button"
              onClick={onOpenPortal}
              className="font-semibold text-slate-600 transition-colors hover:text-teal-700 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            >
              School portal sign-in
            </button>
          ) : null}
          <span>School operation platform</span>
        </div>
      </footer>
    </div>
  )
}
