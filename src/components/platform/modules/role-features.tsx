'use client'

/**
 * PHASE 3 — Role-wise Feature Control (Super Admin Control Center).
 *
 * Lives in the school workspace's Manage tab (section-role-features).
 * Configures, per canonical school role (PRINCIPAL · TEACHER · STUDENT),
 * which school-plane features are available — as REMOVE-ONLY overrides on
 * top of the role's base permissions:
 *
 *   · "On · inherited"  — the role's baseline grants it, no override row.
 *   · "Off · overridden"— an explicit denial row exists (this school's
 *                         choice, shown honestly as overridden).
 *   · "Not available"   — the role's BASE permissions refuse the feature:
 *                         locked, never configurable (a role-level toggle
 *                         must never grant beyond RBAC).
 *
 * Server contract: GET/PATCH /api/platform/schools/[id]/role-features
 * (schools.read / schools.manage). PATCH is diff-based with an optimistic
 * lock (baseUpdatedAt) — a concurrent edit surfaces a typed CONFLICT and
 * an actionable reload banner, never a silent overwrite. Every enforced
 * decision mirrors what the school-plane routes enforce server-side.
 *
 * The same patterns as the Phase-2 editors: optimistic-feeling draft →
 * explicit Save → honest toasts + FormError; server state reloads after
 * save (the server is the only source of truth).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Lock,
  RotateCcw,
  Save,
  Copy,
  Loader2,
} from 'lucide-react'
import { platformApi } from '../platform-client'

// ── Server DTO mirrors ──────────────────────────────────────────────────

interface RoleFeatureCell {
  key: string
  label: string
  description: string
  group: string
  enabled: boolean
  inherited: boolean
  overridden: boolean
  locked: boolean
}

interface RoleFeatureRole {
  role: 'PRINCIPAL' | 'TEACHER' | 'STUDENT'
  cells: RoleFeatureCell[]
  restrictedCount: number
}

interface RoleFeaturesPayload {
  roles: RoleFeatureRole[]
  updatedAt: string | null
}

const ROLE_LABELS: Record<string, string> = {
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
}

const GROUP_ORDER = [
  'people', 'attendance', 'exams', 'homework', 'fees', 'communication', 'operations', 'academics',
] as const
const GROUP_LABELS: Record<string, string> = {
  people: 'People',
  attendance: 'Attendance',
  exams: 'Examinations',
  homework: 'Homework',
  fees: 'Fees',
  communication: 'Communication',
  operations: 'Operations',
  academics: 'Academics',
}

// ── Error affordance (same pattern as the wizard editors) ───────────────

function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
      {message}
    </div>
  )
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in (e as Record<string, unknown>)) {
    const msg = (e as { error?: unknown }).error
    if (typeof msg === 'string') return msg
  }
  return 'Something went wrong. Please try again.'
}

// ── Component ───────────────────────────────────────────────────────────

export function RoleFeaturesSection({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [payload, setPayload] = useState<RoleFeaturesPayload | null>(null)

  // Draft = per-cell EFFECTIVE value (true=on / false=off); null until loaded.
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [role, setRole] = useState<RoleFeatureRole['role']>('PRINCIPAL')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [copyFrom, setCopyFrom] = useState<RoleFeatureRole['role'] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await platformApi<RoleFeaturesPayload>(`/api/platform/schools/${schoolId}/role-features`)
      setPayload(data)
      const next: Record<string, boolean> = {}
      for (const r of data.roles) for (const c of r.cells) next[`${r.role}|${c.key}`] = c.enabled
      setDraft(next)
    } catch (e) {
      setLoadError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => { void load() }, [load])

  const active = payload?.roles.find((r) => r.role === role) ?? null
  const cells = active?.cells ?? []

  /** Draft differs from the server state for this role? */
  const changes = useMemo(() => {
    if (!payload) return []
    const out: Array<{ role: RoleFeatureRole['role']; featureKey: string; denied: boolean; from: boolean }> = []
    for (const r of payload.roles) {
      for (const c of r.cells) {
        const k = `${r.role}|${c.key}`
        if (k in draft && draft[k] !== c.enabled) {
          out.push({ role: r.role, featureKey: c.key, denied: !draft[k], from: c.enabled })
        }
      }
    }
    return out
  }, [payload, draft])

  const dirty = changes.length > 0
  const restrictedCount = cells.filter((c) => !c.enabled && !c.locked).length
  const configurableCount = cells.filter((c) => !c.locked).length

  const setCell = (key: string, value: boolean) => {
    setSaveError(null)
    setConflict(false)
    setDraft((d) => ({ ...d, [`${role}|${key}`]: value }))
  }

  const bulk = (mode: 'enable-all' | 'disable-all' | 'reset') => {
    setSaveError(null)
    setConflict(false)
    setDraft((d) => {
      const next = { ...d }
      for (const c of cells) {
        if (c.locked) continue // locked cells are baseline-refused — never touched
        const k = `${role}|${c.key}`
        if (mode === 'enable-all') next[k] = true
        else if (mode === 'disable-all') next[k] = false
        else next[k] = true // reset → everything the baseline grants is on
      }
      return next
    })
  }

  const applyCopyFrom = (sourceRole: RoleFeatureRole['role']) => {
    if (!payload) return
    setSaveError(null)
    setConflict(false)
    setDraft((d) => {
      const next = { ...d }
      const source = payload.roles.find((r) => r.role === sourceRole)
      if (!source) return next
      for (const c of cells) {
        if (c.locked) continue
        const sc = source.cells.find((x) => x.key === c.key)
        if (!sc || sc.locked) continue
        // Copy only where the SOURCE is explicitly restricted; the target's
        // baseline already caps what it can hold (remove-only by design).
        next[`${role}|${c.key}`] = !(!sc.enabled && !sc.locked)
      }
      return next
    })
    setCopyFrom(null)
    toast.success(`Copied restrictions from ${ROLE_LABELS[sourceRole]} where they apply`)
  }

  const save = async () => {
    if (!payload || !changes.length) return
    setSaving(true)
    setSaveError(null)
    setConflict(false)
    try {
      await platformApi(`/api/platform/schools/${schoolId}/role-features`, {
        method: 'PATCH',
        body: JSON.stringify({
          baseUpdatedAt: payload.updatedAt,
          changes: changes.map((c) => ({ role: c.role, featureKey: c.featureKey, denied: c.denied })),
        }),
      })
      toast.success(`Saved — ${changes.length} change${changes.length > 1 ? 's' : ''} applied`)
      await load()
    } catch (e) {
      const maybe = e as { code?: unknown; status?: unknown }
      if (maybe?.code === 'CONFLICT' || maybe?.status === 409) {
        setConflict(true)
        setSaveError('This configuration was changed by someone else. Reload and apply your changes again.')
      } else {
        setSaveError(errText(e))
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-5 w-64 animate-pulse rounded bg-slate-200" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <FormError message={loadError} />
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    )
  }

  if (!payload) return null

  const byGroup = new Map<string, RoleFeatureCell[]>()
  for (const c of cells) {
    const list = byGroup.get(c.group) ?? []
    list.push(c)
    byGroup.set(c.group, list)
  }
  const groups = GROUP_ORDER.filter((g) => byGroup.has(g))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
          Choose which features each school role can use. Restrictions apply on top of each role&apos;s base
          permissions — they can only narrow access, never widen it, and a disabled module stays unavailable to
          every role. Changes take effect immediately after saving.
        </p>
        <div className="flex flex-none items-center gap-2">
          {!canManage && (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-500">
              Read-only
            </Badge>
          )}
          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-[10px] text-teal-800">
            {restrictedCount} of {configurableCount} restricted
          </Badge>
        </div>
      </div>

      {!canManage && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          You can view this school&apos;s role-wise feature configuration, but changing it requires the
          school-management permission.
        </div>
      )}

      {/* Role selector — horizontally scrollable chips (mobile-safe) */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="School role">
        {payload.roles.map((r) => (
          <button
            key={r.role}
            role="tab"
            aria-selected={role === r.role}
            onClick={() => { setRole(r.role); setSaveError(null); setConflict(false) }}
            className={`flex-none rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
              role === r.role
                ? 'border-teal-600 bg-teal-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {ROLE_LABELS[r.role]}
            {r.restrictedCount > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                role === r.role ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {r.restrictedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {conflict && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <span>{saveError}</span>
          <Button size="sm" variant="outline" className="h-7 flex-none" onClick={() => void load()}>
            Reload configuration
          </Button>
        </div>
      )}
      {saveError && !conflict && <FormError message={saveError} />}

      {/* Bulk controls */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => bulk('enable-all')} disabled={!cells.length}>
            Enable all
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => bulk('disable-all')} disabled={!cells.length}>
            Disable all optional
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => bulk('reset')} disabled={!cells.length}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
          </Button>
          <div className="relative">
            <Button
              variant="outline" size="sm" className="h-8 text-xs"
              onClick={() => setCopyFrom(copyFrom ? null : role)}
              disabled={payload.roles.length < 2}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy from role
            </Button>
            {copyFrom && (
              <div className="absolute left-0 top-9 z-20 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {payload.roles.filter((r) => r.role !== role).map((r) => (
                  <button
                    key={r.role}
                    className="block w-full rounded-md px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() => applyCopyFrom(r.role)}
                  >
                    {ROLE_LABELS[r.role]}
                    <span className="ml-1 text-slate-400">({r.restrictedCount} restricted)</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feature groups — stacked cards (single column on mobile) */}
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {GROUP_LABELS[g] ?? g}
              </h4>
            </div>
            <ul className="divide-y divide-slate-100">
              {byGroup.get(g)!.map((c) => {
                const value = draft[`${role}|${c.key}`]
                return (
                  <li key={c.key} className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{c.label}</span>
                        {c.locked ? (
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-normal text-slate-500">
                            <Lock className="mr-1 h-3 w-3" /> Not available to this role
                          </Badge>
                        ) : c.overridden ? (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-normal text-amber-700">
                            Off · overridden
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-normal text-slate-500">
                            On · inherited
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{c.description}</p>
                      {c.locked && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          The {ROLE_LABELS[role].toLowerCase()}&apos;s base permissions do not include this.
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={!!value}
                      disabled={c.locked || !canManage || saving}
                      onCheckedChange={(v) => setCell(c.key, v)}
                      aria-label={`Toggle ${c.label} for ${ROLE_LABELS[role]}`}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Draft state + save */}
      {canManage && (
        <div className="sticky bottom-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <span className={`text-xs ${dirty ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
            {dirty
              ? `Modified — ${changes.length} unsaved change${changes.length > 1 ? 's' : ''}`
              : 'No unsaved changes'}
          </span>
          <div className="flex flex-none items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={!dirty || saving} onClick={() => void load()}>
              Discard
            </Button>
            <Button
              size="sm"
              className="h-8 bg-teal-600 text-xs text-white hover:bg-teal-700"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
