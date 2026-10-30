'use client'

// ============================================================
// subscription-code-actions — SHARED revoke/reissue dialog for
// activation codes. Used by the school Codes sub-tab and the global
// Access Codes section (/platform/codes) — one action surface, one
// audit contract. Reissue shows the fresh plaintext exactly ONCE
// (OneTimeCodeBlock contract).
// ============================================================

import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { OneTimeCodeBlock, type ActivationCodeRow } from './subscription-shared'
import type { GateFn } from './subscription-batch-codes'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

export function RevokeReissueDialog({
  code,
  action,
  onClose,
  onDone,
  gate,
}: {
  code: ActivationCodeRow
  action: 'revoke' | 'reissue'
  onClose: () => void
  onDone: () => void
  gate: GateFn
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ publicRef: string; code: string; expiresAt: string; message: string } | null>(null)

  const errText = (e: unknown): string => {
    const pae = e as PlatformApiError
    if (pae && typeof pae.error === 'string') return pae.error
    return e instanceof Error ? e.message : 'Request failed'
  }

  const submit = async () => {
    if (reason.trim().length < 4) {
      toast.error('A reason of at least 4 characters is required (audited).')
      return
    }
    setBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; publicRef: string; message: string; code?: string; expiresAt?: string }>(
          `/api/platform/subscriptions/codes/${code.id}`,
          { method: 'PATCH', body: JSON.stringify({ action, reason: reason.trim() }) },
        ),
      )
      if (!res) return
      if (action === 'reissue' && res.code && res.expiresAt) {
        setIssued({ publicRef: res.publicRef, code: res.code, expiresAt: res.expiresAt, message: res.message })
        onDone()
      } else {
        toast.success(res.message)
        onDone()
        onClose()
      }
    } catch (e) {
      toast.error(`${action} failed`, { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !issued) onClose() }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {action === 'revoke' ? 'Revoke activation code' : 'Reissue activation code'}
          </DialogTitle>
          <DialogDescription>
            {action === 'revoke'
              ? `${code.publicRef} becomes permanently unusable. Financial records are unchanged.`
              : `${code.publicRef} becomes REPLACED and a fresh code is issued inheriting the same plan/validity. The plaintext is shown exactly once.`}
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="space-y-3">
            <p className="text-sm">{issued.message}</p>
            <OneTimeCodeBlock code={issued} />
            <DialogFooter>
              <Button onClick={onClose} className="bg-teal-600 hover:bg-teal-700 text-white">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs" htmlFor="code-action-reason">
                Reason (audited)
              </Label>
              <Textarea
                id="code-action-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={action === 'revoke' ? 'Why is this code being revoked?' : 'Why is this code being reissued?'}
                className="bg-white"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} className="border-slate-300">
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={busy}
                variant={action === 'revoke' ? 'destructive' : 'default'}
                className={action === 'reissue' ? 'bg-teal-600 hover:bg-teal-700 text-white' : undefined}
              >
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {action === 'revoke' ? 'Revoke code' : 'Reissue code'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
