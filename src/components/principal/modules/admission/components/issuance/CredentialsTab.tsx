'use client'

import { Copy, Printer, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { IssuanceArtifacts } from './letter-data'

interface CredentialsTabProps {
  artifacts: IssuanceArtifacts
  onCopy: () => void
}

/**
 * Student Portal Welcome / Credential Sheet — a SEPARATE secure document,
 * deliberately NOT part of the official admission letter. Print this and
 * hand it to the parent directly (or send via a private channel).
 */
export function CredentialsTab({ artifacts, onCopy }: CredentialsTabProps) {
  const { loginId, tempPassword } = artifacts

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5">
        {/* Letterhead */}
        <div className="border-b-2 border-slate-200 pb-3">
          <h2 className="font-bold text-base uppercase tracking-wide text-slate-900">
            Student Portal — Welcome &amp; Login Details
          </h2>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Keep this sheet confidential. Change the password at first login.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Portal Address</span>
            <span className="font-mono font-bold text-slate-900">portal.scholario.app</span>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Login ID</span>
            <span className="font-mono font-bold text-slate-900 break-all">{loginId}</span>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Temporary Password</span>
            <span className="font-mono font-bold text-slate-900">{tempPassword}</span>
          </div>
        </div>

        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 p-3 rounded-lg text-[11px] text-amber-900">
          <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p>
            <strong className="font-bold">Security notice:</strong> log in at portal.scholario.app
            and change this temporary password immediately. Do not share these details with anyone
            except the student&apos;s parents/guardians.
          </p>
        </div>

        <p className="text-[9px] text-slate-400 text-center font-mono">
          Credential sheet for Admission {artifacts.admissionNo} · Generated {new Date().toLocaleDateString('en-IN')}
        </p>
      </div>

      <div className="flex items-center gap-2 print:hidden">
        <Button size="sm" onClick={onCopy} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5">
          <Copy className="h-3.5 w-3.5" />
          Copy Credentials
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()} className="text-xs gap-1.5">
          <Printer className="h-3.5 w-3.5" />
          Print Sheet
        </Button>
      </div>
    </div>
  )
}
