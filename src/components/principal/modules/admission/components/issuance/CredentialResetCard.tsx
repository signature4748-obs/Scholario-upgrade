'use client'

/**
 * FEE-ADMISSIONS MVP (Phase F) — the VERIFIED recovery flow for a lost
 * one-time bootstrap credential (POST /api/students/[id]/reset-credential).
 *
 * Only applies to a server-enrolled student account that has NOT yet set
 * its own password (mustChangePassword). The new one-time expiring
 * credential (48h) is surfaced EXACTLY ONCE on THIS response — never
 * persisted, never logged, never re-fetched. The principal is the
 * verified authority inside the school (rate-limited server-side).
 */
import { useState } from 'react'
import { KeyRound, Loader2, Copy, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface CredentialResetCardProps {
  /** The server Student row id (the enrolled student). */
  studentId: string
}

interface ResetResult {
  loginEmail: string
  admissionNo: string | null
  tempPassword: string
  credentialExpiresAt: string
}

export function CredentialResetCard({ studentId }: CredentialResetCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResetResult | null>(null)
  const [revealed, setRevealed] = useState(false)

  const handleReset = async () => {
    if (busy || result) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/reset-credential`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: ResetResult }
        | null
      if (!res.ok || !json?.ok || !json.data?.tempPassword) {
        throw new Error(json?.error || `The credential could not be reset (HTTP ${res.status}).`)
      }
      setResult(json.data)
      setRevealed(false)
      toast.success('A new one-time password was issued', {
        description: 'Shown once — hand it over securely. Valid for 48 hours.',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The credential could not be reset.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!result) return
    const text = [
      `Login ID: ${result.loginEmail}`,
      ...(result.admissionNo ? [`Admission No: ${result.admissionNo}`] : []),
      `Temporary Password: ${result.tempPassword}`,
      'Note: The student must change this password at first sign-in.',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Credentials copied', { description: 'Hand them over securely — shown only once.' })
    } catch {
      toast.error('Could not copy to the clipboard', { description: 'Select the details manually.' })
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 print:hidden">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Lost first password?
          </h4>
          <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">
            If the family lost the one-time password before the first sign-in, issue a new one
            here. Works only while the account has not set its own password. The new password is
            shown once and expires in 48 hours.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">{error}</p>
        </div>
      )}

      {result ? (
        <div className="space-y-2 rounded-lg border bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
            <span className="text-[10px] font-bold uppercase text-slate-500">Login ID</span>
            <span className="font-mono font-bold text-slate-900 break-all">{result.loginEmail}</span>
          </div>
          {result.admissionNo && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
              <span className="text-[10px] font-bold uppercase text-slate-500">Admission No.</span>
              <span className="font-mono font-bold text-slate-900">{result.admissionNo}</span>
            </div>
          )}
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-500 block">
              New Temporary Password
            </span>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {revealed ? (
                <code className="break-all font-mono text-sm font-semibold tracking-wide text-slate-900">
                  {result.tempPassword}
                </code>
              ) : (
                <span className="font-mono text-sm tracking-[0.3em] text-slate-400" aria-hidden="true">
                  ••••••••••••
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? 'Hide temporary password' : 'Show temporary password'}
                className="h-7 w-7 p-0"
              >
                {revealed ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
              <Button type="button" variant="outline" onClick={copy} className="h-7 gap-1.5 px-2.5 text-[11px]">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-amber-600">
              Shown only once — the student must change it at first sign-in.
            </p>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleReset}
          disabled={busy}
          aria-busy={busy}
          className="h-9 gap-1.5 text-xs"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Issuing…
            </>
          ) : (
            <>
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Reset one-time password
            </>
          )}
        </Button>
      )}
    </div>
  )
}
