'use client'

// ============================================================
// SettingsModule — /platform/settings (PHASE 6 console)
// ------------------------------------------------------------
// Platform settings: demo-school visibility, the support-session
// duration ceiling and the module MASTER switches. Any admin can
// read; saving requires settings.manage (the server enforces this
// — the disabled button is UX, not the boundary).
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Settings2, Save, RotateCcw, Info } from 'lucide-react'
import { platformApi, usePlatformSession, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'

interface PlatformSettings {
  showDemoSchool: boolean
  modules: Record<string, boolean>
  supportMaxDuration: number
  flaggableModules: string[]
}

const MODULE_LABELS: Record<string, string> = {
  exams: 'Exams & assessments',
  fees: 'Fees',
  homework: 'Homework',
  library: 'Library',
  transport: 'Transport',
}

interface Draft {
  showDemoSchool: boolean
  supportMaxDuration: string
  modules: Record<string, boolean>
}

function draftFrom(data: PlatformSettings): Draft {
  const modules: Record<string, boolean> = {}
  for (const key of data.flaggableModules) {
    modules[key] = data.modules[key] ?? true
  }
  return {
    showDemoSchool: data.showDemoSchool,
    supportMaxDuration: String(data.supportMaxDuration),
    modules,
  }
}

export function SettingsModule() {
  const { can } = usePlatformSession()
  const [data, setData] = useState<PlatformSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const canManage = can('settings.manage')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await platformApi<PlatformSettings>('/api/platform/settings')
      setData(body)
      setDraft(draftFrom(body))
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Failed to load platform settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Dirty check: which fields changed vs. the server copy.
  const dirty = useMemo(() => {
    if (!data || !draft) return false
    if (draft.showDemoSchool !== data.showDemoSchool) return true
    if (Number(draft.supportMaxDuration) !== data.supportMaxDuration) return true
    for (const key of data.flaggableModules) {
      if ((draft.modules[key] ?? true) !== (data.modules[key] ?? true)) return true
    }
    return false
  }, [data, draft])

  const setModule = (key: string, value: boolean) => {
    setDraft((d) => (d ? { ...d, modules: { ...d.modules, [key]: value } } : d))
  }

  const save = async () => {
    if (!data || !draft) return
    const days = Number(draft.supportMaxDuration)
    if (!Number.isFinite(days) || days < 5 || days > 480) {
      toast.error('Support-session ceiling must be between 5 and 480 minutes')
      return
    }
    // Send ONLY the changed fields.
    const patch: Record<string, unknown> = {}
    if (draft.showDemoSchool !== data.showDemoSchool) patch.showDemoSchool = draft.showDemoSchool
    if (days !== data.supportMaxDuration) patch.supportMaxDuration = days
    const moduleChanges: Record<string, boolean> = {}
    for (const key of data.flaggableModules) {
      if ((draft.modules[key] ?? true) !== (data.modules[key] ?? true)) {
        moduleChanges[key] = draft.modules[key] ?? true
      }
    }
    if (Object.keys(moduleChanges).length > 0) patch.modules = moduleChanges
    if (Object.keys(patch).length === 0) return

    setSaving(true)
    try {
      await platformApi('/api/platform/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      toast.success('Platform settings saved')
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="settings-heading" className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <h1
          id="settings-heading"
          className="font-display text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5"
        >
          <span className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
            <Settings2 className="h-4.5 w-4.5 text-teal-600" aria-hidden="true" />
          </span>
          Platform settings
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          Product-wide configuration for the control plane and every tenant.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </div>
      )}

      {/* Skeletons */}
      {loading && (
        <div className="space-y-4" aria-hidden="true">
          <Skeleton className="h-52 w-full rounded-xl bg-slate-200" />
          <Skeleton className="h-64 w-full rounded-xl bg-slate-200" />
        </div>
      )}

      {!loading && data && draft && (
        <>
          {/* Platform section */}
          <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900 text-base font-semibold">Platform</CardTitle>
              <CardDescription className="text-slate-500 text-xs">
                Global platform behaviour.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <label
                    htmlFor="setting-demo-school"
                    className="text-sm font-medium text-slate-900"
                  >
                    Show demo school in public listings
                  </label>
                  <p className="text-xs text-slate-500">
                    The demo tenant appears on public school surfaces when enabled.
                  </p>
                </div>
                <Switch
                  id="setting-demo-school"
                  checked={draft.showDemoSchool}
                  onCheckedChange={(v) =>
                    setDraft((d) => (d ? { ...d, showDemoSchool: v } : d))
                  }
                  disabled={saving}
                  aria-label="Show demo school in public listings"
                  className="data-[state=checked]:bg-teal-600 focus-ring"
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <label
                    htmlFor="setting-support-duration"
                    className="text-sm font-medium text-slate-900"
                  >
                    Support-session ceiling (minutes)
                  </label>
                  <p className="text-xs text-slate-500">
                    Upper bound for support-session duration. 5–480 minutes.
                  </p>
                </div>
                <Input
                  id="setting-support-duration"
                  type="number"
                  min={5}
                  max={480}
                  value={draft.supportMaxDuration}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, supportMaxDuration: e.target.value } : d))
                  }
                  disabled={saving}
                  className="bg-white border-slate-200 text-slate-900 h-11 w-28 tabular-nums focus-visible:ring-teal-500/40"
                />
              </div>
            </CardContent>
          </Card>

          {/* Module master switches */}
          <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900 text-base font-semibold">
                Module master switches
              </CardTitle>
              <CardDescription className="text-slate-500 text-xs">
                Applies to every school without an explicit override
                (school override ?? this master ?? enabled).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.flaggableModules.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-lg px-3 -mx-3 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="space-y-0.5 min-w-0">
                    <label htmlFor={`setting-module-${key}`} className="text-sm font-medium text-slate-900">
                      {MODULE_LABELS[key] ?? key}
                    </label>
                    <p className="text-xs text-slate-500">
                      {draft.modules[key] ?? true ? 'Available' : 'Disabled'} for tenants without
                      an override.
                    </p>
                  </div>
                  <Switch
                    id={`setting-module-${key}`}
                    checked={draft.modules[key] ?? true}
                    onCheckedChange={(v) => setModule(key, v)}
                    disabled={saving}
                    aria-label={`Master switch for the ${MODULE_LABELS[key] ?? key} module`}
                    className="data-[state=checked]:bg-teal-600 focus-ring"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Save bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500" aria-live="polite">
              {dirty ? (
                <span className="text-amber-700 font-medium">Unsaved changes</span>
              ) : (
                'All changes saved'
              )}
            </p>
            <div className="flex items-center gap-2">
              {dirty && (
                <Button
                  variant="outline"
                  onClick={() => setDraft(draftFrom(data))}
                  disabled={saving}
                  className="h-11 px-4 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-ring"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Discard
                </Button>
              )}
              <Button
                onClick={() => void save()}
                disabled={saving || !dirty || !canManage}
                className="h-11 px-5 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>

          {!canManage && (
            <p
              className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700"
              role="note"
            >
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              Your account can read these settings but lacks the <code>settings.manage</code>{' '}
              capability — saving is disabled. The server rejects unauthorized PATCHes regardless.
            </p>
          )}
        </>
      )}
    </section>
  )
}
