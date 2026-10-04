'use client'

/**
 * People & Access → Roles & Permissions.
 *
 * READ-ONLY summary of the school role model (PRINCIPAL / TEACHER /
 * STUDENT / PARENT high-level capabilities), distilled from the
 * AUTHORITATIVE server-side matrix in src/lib/security/permissions.ts.
 * This is documentation, not a configuration surface — role capabilities
 * are code-defined and enforced server-side on every API call.
 */

import { KeyRound, Check, Minus, Info } from 'lucide-react'
import { SettingsTab } from '../shared'

const ROLES = ['Principal', 'Teacher', 'Student', 'Parent'] as const

/**
 * Plain-language capability rows. Each flag means "holds the capability
 * (possibly scoped to own records / own child)" — scoping is noted in
 * the caption, mirroring the server matrix's ownership checks.
 */
const CAPABILITIES: Array<{ label: string; roles: [boolean, boolean, boolean, boolean] }> = [
  { label: 'School settings (identity, branding, policies)', roles: [true, false, false, false] },
  { label: 'Create & manage teacher accounts', roles: [true, false, false, false] },
  { label: 'Create & manage student records', roles: [true, false, false, false] },
  { label: 'View student directory', roles: [true, true, false, false] },
  { label: 'Enter exams & marks', roles: [true, true, false, false] },
  { label: 'Publish announcements & notices', roles: [true, false, false, false] },
  { label: 'Read announcements & notices', roles: [true, true, true, true] },
  { label: 'Send & receive messages', roles: [true, true, true, true] },
  { label: 'Fees, salary & finance records', roles: [true, false, false, false] },
  { label: 'View own timetable / results / dues', roles: [true, true, true, true] },
  { label: 'View child\'s progress (guardian scope)', roles: [false, false, false, true] },
  { label: 'Manage own profile & password', roles: [true, true, true, true] },
]

export function RolesPermissionsPage() {
  return (
    <SettingsTab
      icon={KeyRound}
      title="Roles & Permissions"
      description="How the four school roles map to capabilities — enforced server-side, read-only here."
    >
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground"
      >
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
        <span className="min-w-0 flex-1">
          Roles are part of the product&apos;s security model — they cannot be edited from your
          school workspace. The authoritative matrix lives server-side
          (<span className="font-mono">src/lib/security/permissions.ts</span>) and is checked on
          every API request; this table is a plain-language summary of it.
        </span>
      </div>

      <div className="overflow-x-auto custom-scrollbar rounded-xl border border-border">
        <table className="w-full min-w-[430px] text-xs">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th scope="col" className="px-3.5 py-2.5 font-semibold text-foreground">
                Capability
              </th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="px-2.5 py-2.5 font-semibold text-foreground text-center w-[76px]">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {CAPABILITIES.map((cap) => (
              <tr key={cap.label} className="bg-card">
                <td className="px-3.5 py-2.5 text-muted-foreground leading-snug">{cap.label}</td>
                {cap.roles.map((has, i) => (
                  <td key={i} className="px-2.5 py-2.5 text-center">
                    {has ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 inline-block" aria-label="yes" />
                    ) : (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground/50 inline-block" aria-label="no" />
                    )}
                    <span className="sr-only">{has ? 'yes' : 'no'}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Student, Parent and Teacher access is always <strong>scoped</strong>: a student sees only
        their own record, a parent/guardian only their child&apos;s, a teacher their assigned
        classes. Staff-only extensions of the principal capabilities (Management, Accountant) and
        the transport-scoped Driver role exist in the same server matrix. Platform operators
        (SCHOLARIO admins) are a separate identity plane — they never appear inside a school
        workspace.
      </p>
    </SettingsTab>
  )
}
