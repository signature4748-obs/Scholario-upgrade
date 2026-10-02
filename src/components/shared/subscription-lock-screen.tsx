'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrentUser, type MeUser } from '@/lib/store/current-user-store'
import { useAuth } from '@/lib/store/auth-store'

/**
 * SubscriptionLockScreen — Phase 10 (final acceptance).
 *
 * Rendered INSTEAD of the role panels when the server identity
 * (/api/auth/me) reports subscriptionStatus 'LOCKED'. The account is
 * authenticated and ACTIVE — it sees its own identity particulars
 * (name, guardian/father, contact, photo avatar, enrollment context)
 * and the honest subscription notice. Every module API rejects the
 * account server-side (403 SUBSCRIPTION_REQUIRED via withUser), so this
 * screen is a courtesy surface, NEVER the enforcement layer.
 */
const ROLE_LABELS: Record<string, string> = {
  PRINCIPAL: 'Principal',
  MANAGEMENT: 'School Office',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

export function SubscriptionLockScreen({ user }: { user: MeUser }) {
  const logout = useAuth((s) => s.logout)
  const clear = useCurrentUser((s) => s.clear)

  useEffect(() => {
    document.title = 'Subscription Required — Scholario'
  }, [])

  const handleSignOut = () => {
    void fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => {})
    logout()
    clear()
    if (typeof window !== 'undefined') window.location.reload()
  }

  const student = user.student ?? null
  const roleLabel = ROLE_LABELS[user.role] ?? user.role

  return (
    <div className="min-h-screen mesh-bg flex flex-col">
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-md border-border/80 shadow-xl">
          <CardContent className="p-6 space-y-6">
            {/* Identity block — the data a LOCKED account may still see */}
            <div className="flex items-center gap-4">
              <div
                aria-hidden
                className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-lg font-bold shrink-0"
              >
                {initials(user.name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-foreground">{user.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {roleLabel}
                  {student?.classLabel ? ` · ${student.classLabel}` : ''}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            <div aria-label="Profile information">
              <Row label="Father / Guardian" value={student?.guardianName ?? null} />
              <Row label="Guardian Contact" value={student?.guardianPhone ?? null} />
              <Row label="Mobile" value={user.phone} />
              {student?.rollNo ? <Row label="Roll No" value={student.rollNo} /> : null}
              {student?.admissionNo ? <Row label="Admission No" value={student.admissionNo} /> : null}
              {user.school?.name ? <Row label="School" value={user.school.name} /> : null}
            </div>

            {/* The honest subscription notice */}
            <div
              role="alert"
              className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/60 p-4 space-y-1"
            >
              <p className="text-sm font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                Subscription Required
              </p>
              <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
                Your account can currently access profile information only. Classes, marks, fees,
                attendance and other modules stay locked until the subscription is renewed. Please
                contact the school office.
              </p>
            </div>

            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto py-4 text-center text-xs text-muted-foreground">
        {user.school?.name ?? 'Scholario'} · Session {user.school?.academicYear ?? ''}
      </footer>
    </div>
  )
}
