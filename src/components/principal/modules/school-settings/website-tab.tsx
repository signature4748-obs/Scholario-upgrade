'use client'

/**
 * Website tab (PHASE 7.5) — the school's Website CMS.
 *
 * Data source: GET /api/school/website (the full merged WebsiteContent
 * document). Every section is its own card with a LOCAL draft and its own
 * Save button → PATCH /api/school/website with JUST that section (the API
 * replaces stored sections present in the body, keeps the rest, max 32 KB).
 * The Gallery manager lives in this tab as its own sub-section
 * (website-gallery.tsx).
 *
 * Honesty: loading skeleton → content; error → retry with the server
 * message; empty list sections start from the neutral defaults the public
 * site renders.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Globe, Save, RefreshCw, Loader2, AlertTriangle, Plus, Trash2,
  ChevronUp, ChevronDown, Megaphone, MapPin, Sparkles, Compass,
  Trophy, BookOpen, Search, Footprints, X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { GlassCard } from '@/components/shared/ui'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  WEBSITE_ICON_KEYS,
  type WebsiteContent,
  type PillarItem,
  type JourneyStage,
  type FacilityItem,
  type CtaConfig,
} from '@/lib/website-content'
import { GalleryManager } from './website-gallery'
import { SettingsTab } from './shared'

// ── load / save plumbing ────────────────────────────────────────────

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

// ── shared section card shell ───────────────────────────────────────

function SectionCard({
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

function FieldRow({
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

function IconKeySelect({
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

function ListEditor<T extends ListEditorItem>({
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
              <div key={f.key} className={f.area ? 'sm:col-span-2' : f.key === 'icon' ? '' : ''}>
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

// ── string-list editor (admissions highlights) ──────────────────────

function StringListEditor({
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

// ── section components ──────────────────────────────────────────────

interface SectionProps {
  content: WebsiteContent
  onSaved: (content: WebsiteContent) => void
}

function useSectionState() {
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

function HeroSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.hero)
  useEffect(() => { setDraft(content.hero) }, [content.hero])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.hero)
  const set = (patch: Partial<WebsiteContent['hero']>) => setDraft((d) => ({ ...d, ...patch }))
  const setCta = (key: 'ctaPrimary' | 'ctaSecondary', patch: Partial<CtaConfig>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }))

  return (
    <SectionCard
      icon={Globe}
      title="Hero"
      description="The landing banner: headline, supporting line and call-to-action labels."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() =>
        void saveSection('hero', draft, onSaved, 'Hero section saved — the public site updates immediately.')
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="hero-badge" label="Badge Prefix" hint='Renders as “Admissions open for <Session>”.'>
          <Input id="hero-badge" value={draft.badgePrefix} onChange={(e) => set({ badgePrefix: e.target.value })} className="h-8 text-xs" maxLength={80} />
        </FieldRow>
        <FieldRow id="hero-title" label="Headline (line 1)">
          <Input id="hero-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-xs" maxLength={80} />
        </FieldRow>
        <FieldRow id="hero-accent" label="Headline Accent (line 2)">
          <Input id="hero-accent" value={draft.titleAccent} onChange={(e) => set({ titleAccent: e.target.value })} className="h-8 text-xs" maxLength={80} />
        </FieldRow>
        <FieldRow id="hero-primary-label" label="Primary Button Label">
          <Input id="hero-primary-label" value={draft.ctaPrimary.label} onChange={(e) => setCta('ctaPrimary', { label: e.target.value })} className="h-8 text-xs" maxLength={60} />
        </FieldRow>
        <FieldRow id="hero-secondary-label" label="Secondary Button Label">
          <Input id="hero-secondary-label" value={draft.ctaSecondary.label} onChange={(e) => setCta('ctaSecondary', { label: e.target.value })} className="h-8 text-xs" maxLength={60} />
        </FieldRow>
        <div className="sm:col-span-2">
          <FieldRow id="hero-desc" label="Supporting Description" hint="One or two sentences shown under the headline.">
            <Textarea id="hero-desc" rows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} className="text-xs" maxLength={400} />
          </FieldRow>
        </div>
      </div>
    </SectionCard>
  )
}

function AboutSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.about)
  useEffect(() => { setDraft(content.about) }, [content.about])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.about)

  return (
    <SectionCard
      icon={Sparkles}
      title="About"
      description="The about-block heading and sub-line."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('about', draft, onSaved, 'About section saved.')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="about-title" label="Title">
          <Input id="about-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="about-sub" label="Subtitle">
          <Input id="about-sub" value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} className="h-8 text-xs" maxLength={160} />
        </FieldRow>
      </div>
    </SectionCard>
  )
}

function PillarsSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState<PillarItem[]>(content.pillars)
  useEffect(() => { setDraft(content.pillars) }, [content.pillars])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.pillars)

  return (
    <SectionCard
      icon={Trophy}
      title="Pillars"
      description="The value-proposition cards shown under the hero."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('pillars', draft, onSaved, 'Pillars saved.')}
    >
      <ListEditor<PillarItem>
        items={draft}
        onChange={setDraft}
        blankItem={{ icon: 'target', title: '', description: '' }}
        addLabel="Add Pillar"
        fields={[
          { key: 'icon', label: 'Icon' },
          { key: 'title', label: 'Title', placeholder: 'Academic Focus' },
          { key: 'description', label: 'Description', placeholder: 'One line per pillar.', area: true },
        ]}
      />
    </SectionCard>
  )
}

function JourneySection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.journey)
  useEffect(() => { setDraft(content.journey) }, [content.journey])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.journey)
  const set = (patch: Partial<WebsiteContent['journey']>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <SectionCard
      icon={Compass}
      title="Journey"
      description="Programme stages by grade band (Primary / Middle / Senior …)."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('journey', draft, onSaved, 'Journey section saved.')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="journey-title" label="Section Title">
          <Input id="journey-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="journey-sub" label="Section Subtitle">
          <Input id="journey-sub" value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className="h-8 text-xs" maxLength={160} />
        </FieldRow>
      </div>
      <ListEditor<JourneyStage>
        items={draft.stages}
        onChange={(stages) => set({ stages })}
        blankItem={{ icon: 'sprout', title: '', grades: '', years: '', description: '' }}
        addLabel="Add Stage"
        fields={[
          { key: 'icon', label: 'Icon' },
          { key: 'title', label: 'Stage Title', placeholder: 'Primary' },
          { key: 'grades', label: 'Grades', placeholder: 'Grade 1–5' },
          { key: 'years', label: 'Ages', placeholder: 'Ages 6–11' },
          { key: 'description', label: 'Description', placeholder: 'One line per stage.', area: true },
        ]}
      />
    </SectionCard>
  )
}

function FacilitiesSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.facilities)
  useEffect(() => { setDraft(content.facilities) }, [content.facilities])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.facilities)
  const set = (patch: Partial<WebsiteContent['facilities']>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <SectionCard
      icon={BookOpen}
      title="Facilities"
      description="Campus facility cards. State only what the school actually offers."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('facilities', draft, onSaved, 'Facilities section saved.')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="fac-title" label="Section Title">
          <Input id="fac-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="fac-sub" label="Section Subtitle">
          <Input id="fac-sub" value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className="h-8 text-xs" maxLength={160} />
        </FieldRow>
      </div>
      <ListEditor<FacilityItem>
        items={draft.items}
        onChange={(items) => set({ items })}
        blankItem={{ icon: 'library', title: '', description: '' }}
        addLabel="Add Facility"
        fields={[
          { key: 'icon', label: 'Icon' },
          { key: 'title', label: 'Facility', placeholder: 'Library' },
          { key: 'description', label: 'Description', placeholder: 'One line per facility.', area: true },
        ]}
      />
    </SectionCard>
  )
}

function PrincipalMessageSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.principalMessage)
  useEffect(() => { setDraft(content.principalMessage) }, [content.principalMessage])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.principalMessage)

  return (
    <SectionCard
      icon={Megaphone}
      title="Principal's Message"
      description="Optional welcome note shown on the About area of the public site."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('principalMessage', draft, onSaved, "Principal's message saved.")}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
          <Switch
            id="pm-enabled"
            checked={draft.enabled}
            onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            className="mt-0.5"
            aria-label="Show principal's message on the website"
          />
          <div className="min-w-0">
            <Label htmlFor="pm-enabled" className="text-xs font-semibold cursor-pointer">
              Show on the public website
            </Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              When off, the section is hidden — nothing partial renders.
            </p>
          </div>
        </div>
        <FieldRow id="pm-title" label="Title">
          <Input id="pm-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="pm-message" label="Message">
          <Textarea id="pm-message" rows={5} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} className="text-xs" maxLength={1200} placeholder="A short, personal note to families." />
        </FieldRow>
      </div>
    </SectionCard>
  )
}

function AdmissionsSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.admissions)
  useEffect(() => { setDraft(content.admissions) }, [content.admissions])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.admissions)
  const set = (patch: Partial<WebsiteContent['admissions']>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <SectionCard
      icon={Footprints}
      title="Admissions"
      description="Admissions copy, highlight bullets and office hours."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('admissions', draft, onSaved, 'Admissions section saved.')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="adm-title" label="Nav Label">
          <Input id="adm-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-xs" maxLength={60} />
        </FieldRow>
        <FieldRow id="adm-sub" label="Sub Label">
          <Input id="adm-sub" value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className="h-8 text-xs" maxLength={80} />
        </FieldRow>
        <FieldRow id="adm-heading" label="Heading">
          <Input id="adm-heading" value={draft.heading} onChange={(e) => set({ heading: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="adm-hours" label="Office Hours">
          <Input id="adm-hours" value={draft.officeHours} onChange={(e) => set({ officeHours: e.target.value })} className="h-8 text-xs" maxLength={160} placeholder="Mon–Sat · 9:00 AM – 1:00 PM" />
        </FieldRow>
        <div className="sm:col-span-2">
          <FieldRow id="adm-desc" label="Description">
            <Textarea id="adm-desc" rows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} className="text-xs" maxLength={600} />
          </FieldRow>
        </div>
        <div className="sm:col-span-2">
          <FieldRow id="adm-highlights" label="Highlight Bullets" hint="Short factual lines rendered as a list.">
            <StringListEditor
              items={draft.highlights}
              onChange={(highlights) => set({ highlights })}
              label="Highlight"
              placeholder="Saturday campus tours at 10 AM"
              addLabel="Add Highlight"
            />
          </FieldRow>
        </div>
      </div>
    </SectionCard>
  )
}

function ContactSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.contact)
  useEffect(() => { setDraft(content.contact) }, [content.contact])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.contact)

  return (
    <SectionCard
      icon={MapPin}
      title="Contact"
      description="Contact-block heading and sub-line (address/phone come from School Identity)."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('contact', draft, onSaved, 'Contact section saved.')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="contact-title" label="Title">
          <Input id="contact-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="contact-sub" label="Subtitle">
          <Input id="contact-sub" value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} className="h-8 text-xs" maxLength={160} />
        </FieldRow>
      </div>
    </SectionCard>
  )
}

const SOCIAL_KEYS = ['facebook', 'instagram', 'youtube', 'twitter', 'linkedin'] as const

function FooterSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.footer)
  useEffect(() => { setDraft(content.footer) }, [content.footer])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.footer)

  return (
    <SectionCard
      icon={Globe}
      title="Footer"
      description="Footer about line and social profile links."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('footer', draft, onSaved, 'Footer saved.')}
    >
      <div className="space-y-3">
        <FieldRow id="footer-about" label="About Line" hint="One sentence about the school at the bottom of the site.">
          <Textarea id="footer-about" rows={2} value={draft.about} onChange={(e) => setDraft({ ...draft, about: e.target.value })} className="text-xs" maxLength={300} />
        </FieldRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOCIAL_KEYS.map((key) => (
            <FieldRow key={key} id={`footer-${key}`} label={key.charAt(0).toUpperCase() + key.slice(1)}>
              <Input
                id={`footer-${key}`}
                value={draft.social[key] ?? ''}
                onChange={(e) => setDraft({ ...draft, social: { ...draft.social, [key]: e.target.value } })}
                className="h-8 text-xs"
                placeholder="https://…"
                maxLength={200}
              />
            </FieldRow>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}

function SeoSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.seo)
  useEffect(() => { setDraft(content.seo) }, [content.seo])
  const dirty =
    (draft.title ?? '') !== (content.seo.title ?? '') ||
    (draft.description ?? '') !== (content.seo.description ?? '')

  return (
    <SectionCard
      icon={Search}
      title="SEO"
      description="Search-engine title and description for the public site."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('seo', draft, onSaved, 'SEO metadata saved.')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="seo-title" label="Page Title" hint="Falls back to “<School name> — Official Website”.">
          <Input id="seo-title" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-8 text-xs" maxLength={120} />
        </FieldRow>
        <FieldRow id="seo-desc" label="Meta Description" hint="Falls back to the hero description.">
          <Textarea id="seo-desc" rows={3} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="text-xs" maxLength={300} />
        </FieldRow>
      </div>
    </SectionCard>
  )
}

// ── the tab ─────────────────────────────────────────────────────────

export function WebsiteTab() {
  const { content, setContent, state, error, reload } = useWebsiteContent()

  return (
    <div className="space-y-5">
      <SettingsTab
        icon={Globe}
        title="School Website"
        description="Content, images and SEO for the public website — every section saves independently."
        action={
          state === 'loaded' ? (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void reload()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          ) : undefined
        }
      >
        <p className="text-[11px] text-muted-foreground">
          Sections save to the school&apos;s website record and render on the public site immediately.
          The Gallery manager below this list handles photo albums.
        </p>
      </SettingsTab>

      {state === 'loading' && (
        <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading website content…
          </div>
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-muted/60 animate-pulse" />
            ))}
          </div>
        </GlassCard>
      )}

      {state === 'error' && (
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">Website content could not be loaded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{error}</p>
            </div>
          </div>
          <div>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void reload()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </GlassCard>
      )}

      {state === 'loaded' && content && (
        <>
          <HeroSection content={content} onSaved={setContent} />
          <AboutSection content={content} onSaved={setContent} />
          <PillarsSection content={content} onSaved={setContent} />
          <JourneySection content={content} onSaved={setContent} />
          <FacilitiesSection content={content} onSaved={setContent} />
          <PrincipalMessageSection content={content} onSaved={setContent} />
          <AdmissionsSection content={content} onSaved={setContent} />
          <ContactSection content={content} onSaved={setContent} />
          <FooterSection content={content} onSaved={setContent} />
          <SeoSection content={content} onSaved={setContent} />
          <GalleryManager />
        </>
      )}
    </div>
  )
}
