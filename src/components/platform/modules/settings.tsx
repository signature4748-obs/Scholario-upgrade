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
          className="font-display text-xl sm:text-2xl font-bold text-zinc-100 flex items-center gap-2.5"
        >
          <span className="h-9 w-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <Settings2 className="h-4.5 w-4.5 text-emerald-400" aria-hidden="true" />
          </span>
          Platform settings
        </h1>
        <p className="text-sm text-zinc-400 mt-2">
          Product-wide configuration for the control plane and every tenant.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {/* Skeletons */}
      {loading && (
        <div className="space-y-4" aria-hidden="true">
          <Skeleton className="h-52 w-full rounded-xl bg-zinc-800/70" />
          <Skeleton className="h-64 w-full rounded-xl bg-zinc-800/70" />
        </div>
      )}

      {!loading && data && draft && (
        <>
          {/* Platform section */}
          <Card className="rounded-xl border-zinc-800 bg-zinc-900/60">
            <CardHeader>
              <CardTitle className="text-zinc-100 text-base font-semibold">Platform</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Global platform behaviour.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <label
                    htmlFor="setting-demo-school"
                    className="text-sm font-medium text-zinc-200"
                  >
                    Show demo school in public listings
                  </label>
                  <p className="text-xs text-zinc-500">
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
                  className="data-[state=checked]:bg-emerald-500 focus-ring"
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <label
                    htmlFor="setting-support-duration"
                    className="text-sm font-medium text-zinc-200"
                  >
                    Support-session ceiling (minutes)
                  </label>
                  <p className="text-xs text-zinc-500">
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
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 h-11 w-28 tabular-nums focus-visible:ring-emerald-500/40"
                />
              </div>
            </CardContent>
          </Card>

          {/* Module master switches */}
          <Card className="rounded-xl border-zinc-800 bg-zinc-900/60">
            <CardHeader>
              <CardTitle className="text-zinc-100 text-base font-semibold">
                Module master switches
              </CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Applies to every school without an explicit override
                (school override ?? this master ?? enabled).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.flaggableModules.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-lg px-3 -mx-3 py-3 hover:bg-zinc-800/40 transition-colors"
                >
                  <div className="space-y-0.5 min-w-0">
                    <label htmlFor={`setting-module-${key}`} className="text-sm font-medium text-zinc-200">
                      {MODULE_LABELS[key] ?? key}
                    </label>
                    <p className="text-xs text-zinc-500">
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
                    className="data-[state=checked]:bg-emerald-500 focus-ring"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Save bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs text-zinc-500" aria-live="polite">
              {dirty ? (
                <span className="text-amber-300 font-medium">Unsaved changes</span>
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
                  className="h-11 px-4 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-ring"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Discard
                </Button>
              )}
              <Button
                onClick={() => void save()}
                disabled={saving || !dirty || !canManage}
                className="h-11 px-5 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>

          {!canManage && (
            <p
              className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300"
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
