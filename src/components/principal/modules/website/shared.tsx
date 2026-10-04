'use client'

/**
 * Website Management module — shared machinery (task 2-a).
 *
 * The section-editor primitives (SectionCard / FieldRow / ListEditor /
 * StringListEditor / the content load+patch hooks) are ADAPTED from the
 * Phase 7.5 settings Website tab (school-settings/website-tab.tsx) —
 * same PATCH /api/school/website partial-section semantics — so the
 * module and the legacy tab stay behaviour-identical while both live.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Save, Loader2, ChevronUp, ChevronDown, Plus, Trash2, X, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { GlassCard } from '@/components/shared/ui'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  WEBSITE_ICON_KEYS,
  type WebsiteContent,
} from '@/lib/website-content'

// ── load / save plumbing (copied semantics from website-tab.tsx) ─────

export type WebsiteLoadState = 'loading' | 'error' | 'loaded'

export function useWebsiteContent() {
  const [content, setContent] = useState<WebsiteContent | null>(null)
  const [state, setState] = useState<WebsiteLoadState>('loading')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const r = await fetch('/api/school/website', { cache: 'no-store' })
      const j = (await r.json().catch(() => null)) as
        | { success?: boolean; error?: string; data?: { content?: WebsiteContent } }
        | null
      if (!r.ok || !j?.success || !j.data?.content) {
        throw new Error(j?.error ?? 'Website content could not be loaded.')
      }
      setContent(j.data.content)
      setState('loaded')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Website content could not be loaded.')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { content, setContent, state, error, reload: load }
}

/** PATCH one section; on success returns the merged content. */
export async function patchWebsiteSection(
  sectionKey: string,
  value: unknown,
): Promise<{ ok: boolean; error: string | null; content: WebsiteContent | null }> {
  try {
    const r = await fetch('/api/school/website', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [sectionKey]: value }),
    })
    const j = (await r.json().catch(() => null)) as
      | { success?: boolean; error?: string; data?: { content?: WebsiteContent } }
      | null
    if (!r.ok || !j?.success || !j.data?.content) {
      return { ok: false, error: j?.error ?? 'The section could not be saved.', content: null }
    }
    return { ok: true, error: null, content: j.data.content }
  } catch {
    return { ok: false, error: 'Website server is unreachable — check your connection and retry.', content: null }
  }
}

/** Generic JSON API helper: returns the server's verbatim error message. */
export async function apiJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; error: string | null; data: T | null }> {
  try {
    const r = await fetch(url, { cache: 'no-store', ...init })
    const j = (await r.json().catch(() => null)) as
      | { success?: boolean; ok?: boolean; error?: string; data?: T }
      | null
    if (!r.ok || (!j?.success && !j?.ok)) {
      return { ok: false, error: j?.error ?? 'The server returned an error. Please retry.', data: null }
    }
    return { ok: true, error: null, data: (j?.data ?? null) as T | null }
  } catch {
    return { ok: false, error: 'Server is unreachable — check your connection and retry.', data: null }
  }
}

// ── shared section card shell (from website-tab.tsx) ─────────────────

export function SectionCard({
  icon: Icon,
  title,
  description,
  dirty,
  saving,
  error,
  onSave,
  saveLabel = 'Save Section',
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  dirty: boolean
  saving: boolean
  error: string | null
  onSave: () => void
  saveLabel?: string
  children: React.ReactNode
}) {
  return (
    <GlassCard className="p-5 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
            <Icon className="h-4 w-4 text-emerald-600" /> {title}
          </h4>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-2.5">
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border',
              dirty
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
            )}
          >
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </>
            ) : dirty ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Saved
              </>
            )}
          </span>
          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={onSave}
            className="gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Save className="h-3.5 w-3.5" /> {saveLabel}
          </Button>
        </div>
      </div>
      {children}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300"
        >
          {error}
        </div>
      )}
    </GlassCard>
  )
}

export function FieldRow({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs font-semibold mb-1 block">
        {label}
      </Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ── icon-key dropdown (WEBSITE_ICON_KEYS) ────────────────────────────

export function IconKeySelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full h-8 text-xs" aria-label="Icon">
        <SelectValue placeholder="Icon" />
      </SelectTrigger>
      <SelectContent>
        {WEBSITE_ICON_KEYS.map((k) => (
          <SelectItem key={k} value={k} className="text-xs capitalize">
            {k}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── list editor (pillars / journey stages / facilities) ─────────────

interface ListEditorItem {
  icon: string
  title: string
  description: string
  grades?: string
  years?: string
}

export function ListEditor<T extends ListEditorItem>({
  items,
  fields,
  blankItem,
  onChange,
  maxItems = 12,
  addLabel,
}: {
  items: T[]
  fields: Array<{ key: 'icon' | 'title' | 'description' | 'grades' | 'years'; label: string; placeholder?: string; area?: boolean }>
  blankItem: T
  onChange: (next: T[]) => void
  maxItems?: number
  addLabel: string
}) {
  const set = (idx: number, patch: Partial<T>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx))
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const tmp = next[idx]
    next[idx] = next[target]
    next[target] = tmp
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="rounded-xl border border-border bg-card/40 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
              Item {idx + 1}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                aria-label={`Move item ${idx + 1} up`}
                title="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={idx === items.length - 1}
                onClick={() => move(idx, 1)}
                aria-label={`Move item ${idx + 1} down`}
                title="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                onClick={() => remove(idx)}
                aria-label={`Remove item ${idx + 1}`}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {fields.map((f) => (
              <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
                <Label htmlFor={`le-${idx}-${f.key}`} className="text-[11px] font-semibold mb-1 block">
                  {f.label}
                </Label>
                {f.key === 'icon' ? (
                  <IconKeySelect id={`le-${idx}-icon`} value={item.icon} onChange={(v) => set(idx, { icon: v } as Partial<T>)} />
                ) : f.area ? (
                  <Textarea
                    id={`le-${idx}-${f.key}`}
                    rows={2}
                    value={(item[f.key] as string) ?? ''}
                    onChange={(e) => set(idx, { [f.key]: e.target.value } as unknown as Partial<T>)}
                    placeholder={f.placeholder}
                    className="text-xs"
                    maxLength={400}
                  />
                ) : (
                  <Input
                    id={`le-${idx}-${f.key}`}
                    value={(item[f.key] as string) ?? ''}
                    onChange={(e) => set(idx, { [f.key]: e.target.value } as unknown as Partial<T>)}
                    placeholder={f.placeholder}
                    className="h-8 text-xs"
                    maxLength={120}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={items.length >= maxItems}
        onClick={() => onChange([...items, { ...blankItem }])}
        className="h-8 text-xs gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  )
}

// ── string-list editor ──────────────────────────────────────────────

export function StringListEditor({
  items,
  onChange,
  label,
  placeholder,
  addLabel,
  maxItems = 12,
}: {
  items: string[]
  onChange: (next: string[]) => void
  label: string
  placeholder?: string
  addLabel: string
  maxItems?: number
}) {
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            aria-label={`${label} ${idx + 1}`}
            value={item}
            onChange={(e) => onChange(items.map((s, i) => (i === idx ? e.target.value : s)))}
            placeholder={placeholder}
            className="h-8 text-xs"
            maxLength={200}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            aria-label={`Remove ${label} ${idx + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={items.length >= maxItems}
        onClick={() => onChange([...items, ''])}
        className="h-8 text-xs gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  )
}

// ── section save state hook ─────────────────────────────────────────

export interface SectionProps {
  content: WebsiteContent
  onSaved: (content: WebsiteContent) => void
}

export function useSectionState() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveSection = async (
    key: string,
    value: unknown,
    onSaved: (content: WebsiteContent) => void,
    successToast: string,
  ) => {
    setSaving(true)
    setError(null)
    const result = await patchWebsiteSection(key, value)
    setSaving(false)
    if (result.ok && result.content) {
      onSaved(result.content)
      toast.success(successToast)
    } else {
      setError(result.error)
      toast.error(result.error ?? 'The section could not be saved.')
    }
  }
  return { saving, error, saveSection }
}

// ── honest loading / error blocks (module-wide) ──────────────────────

export function ModuleLoading({ label = 'Loading website content…' }: { label?: string }) {
  return (
    <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {label}
      </div>
      <div className="space-y-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-muted/60 animate-pulse" />
        ))}
      </div>
    </GlassCard>
  )
}

export function ModuleError({
  message,
  onRetry,
  title = 'Could not be loaded',
}: {
  message: string
  onRetry: () => void
  title?: string
}) {
  return (
    <GlassCard className="p-5 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{message}</p>
        </div>
      </div>
      <div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    </GlassCard>
  )
}
