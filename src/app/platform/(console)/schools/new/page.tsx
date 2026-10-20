'use client'

// ============================================================
// /platform/schools/new — the full-page Add School workspace
// ------------------------------------------------------------
// The seven-step onboarding wizard is a DEDICATED PAGE in the
// Schools hierarchy (2026-10-20 control-plane mandate): reachable
// by URL, reload-safe (draft auto-save with an explicit
// resume/discard decision), and never a cramped modal that one
// stray click can dismiss with seven steps of input inside.
//
// Authorization: the console shell gates this route on a valid
// platform session (middleware + ConsoleShell). This page adds the
// narrow UX guard for an authenticated admin WITHOUT the
// schools.provision permission — the honest no-access state below.
// The server remains the authority: every wizard API call is
// permission-checked by withPlatform() regardless of this render.
// ============================================================

import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'
import { usePlatformSession } from '@/components/platform/platform-client'
import { ProvisionWizard } from '@/components/platform/modules/provision-wizard'
import { Button } from '@/components/ui/button'

export default function AddSchoolPage() {
  const { me, can } = usePlatformSession()

  // Authenticated but not provision-authorized: an honest, actionable
  // no-access state (never a dead spinner or a raw 403 later).
  if (me && !can('schools.provision')) {
    return (
      <div className="mx-auto w-full max-w-md">
        <div
          role="alert"
          className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
        >
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
            <Lock className="h-5 w-5 text-slate-500" aria-hidden="true" />
          </div>
          <h1 className="mt-3 font-display text-lg font-bold text-slate-900">
            Provisioning requires permission
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Your account does not hold the <span className="font-mono text-xs">schools.provision</span>{' '}
            permission, so the Add School workspace is not available to you.
          </p>
          <Button
            asChild
            className="mt-4 h-10 bg-teal-600 font-semibold text-white hover:bg-teal-700 focus-ring"
          >
            <Link href="/platform/schools">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Schools
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return <ProvisionWizard />
}
