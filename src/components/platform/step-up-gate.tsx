'use client'

// ============================================================
// Step-up gate — shared destructive-action helper (PHASE 6)
// ------------------------------------------------------------
// Destructive control-plane APIs reject with 403 STEP_UP_REQUIRED
// when the 10-minute MFA window is stale. Modules wrap their
// destructive calls in `gate()`:
//
//   const { gate, node } = useStepUpGate()
//   await gate(() => platformApi('/api/platform/schools/x/suspend', …))
//
// gate() runs the action; on STEP_UP_REQUIRED it renders the TOTP
// dialog (this component's `node` must be mounted), verifies via
// POST /api/platform/auth/step-up, then retries the action ONCE.
// Cancel → returns undefined (action not performed).
// ============================================================

import React, { useCallback, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from './platform-client'

export function useStepUpGate() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const resolver = useRef<((verified: boolean) => void) | null>(null)

  const requestVerification = useCallback((): Promise<boolean> => {
    setOpen(true)
    setError(null)
    setCode('')
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((verified: boolean) => {
    resolver.current?.(verified)
    resolver.current = null
    setOpen(false)
    setBusy(false)
  }, [])

  const verify = useCallback(async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await platformApi('/api/platform/auth/step-up', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      toast.success('Step-up verified — retrying the action')
      settle(true)
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Verification failed')
      setBusy(false)
    }
  }, [code, settle])

  /**
   * Run a destructive action with automatic step-up handling: on
   * STEP_UP_REQUIRED the TOTP dialog opens; after successful
   * verification the action is retried exactly once.
   */
  const gate = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await action()
      } catch (e) {
        const err = e as PlatformApiError
        if (err?.code !== 'STEP_UP_REQUIRED') throw e
        const verified = await requestVerification()
        if (!verified) return undefined
        return await action()
      }
    },
    [requestVerification],
  )

  const node = (
    <Dialog open={open} onOpenChange={(v) => !v && settle(false)}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Step-up authentication required
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            This destructive action needs a recent multi-factor verification. Enter the current
            code from your authenticator app — the action will continue automatically.
          </DialogDescription>
        </DialogHeader>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void verify()
          }}
          autoFocus
          aria-label="Authenticator code"
          className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 text-lg tracking-[0.4em] text-center font-mono h-12"
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => settle(false)}
            className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
          >
            Cancel action
          </Button>
          <Button onClick={() => void verify()} disabled={busy} className="bg-teal-600 hover:bg-teal-700 text-white">
            {busy ? 'Verifying…' : 'Verify & continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { gate, node }
}
