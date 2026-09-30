'use client'

/**
 * Branding tab (PHASE 7.5) — NEW.
 *
 * Server-backed school branding through PATCH /api/school-settings
 * { branding: {…} }:
 *
 *   · primaryColor + accentColor pickers (color swatch + hex text input
 *     kept in sync) with a CLIENT-side contrast pre-check replicating the
 *     server rule (WCAG relative luminance ≥ 3.5:1 on white) — the inline
 *     warning shows the same message the server would return, before submit
 *   · logo + favicon uploads through POST /api/school/website/upload
 *     (website-scope, JPG/PNG/WebP ≤ 4 MB); the returned file id is
 *     PATCHed as branding.logoUrl / branding.faviconUrl; "Remove" sends
 *     null. Uploads save IMMEDIATELY (the file lives server-side the
 *     moment it uploads).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Palette, Save, Upload, X, ImageIcon, AlertTriangle, Loader2, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
} from '@/lib/store/school-settings-store'
import {
  primaryContrastIssue,
  contrastOnWhite,
  PRIMARY_CONTRAST_MIN,
  isValidHexColor,
} from '@/lib/branding-contrast'
import { patchSchoolSettings, uploadWebsiteImage } from './server-api'
import { SettingsTab, FieldGroup, SyncGate, SyncChip } from './shared'

interface BrandingDraft {
  primaryColor: string
  accentColor: string
}

function draftFromServer(b: { primaryColor: string; accentColor: string } | null, fallback: string): BrandingDraft {
  return {
    primaryColor: b?.primaryColor ?? fallback,
    accentColor: b?.accentColor ?? '#f59e0b',
  }
}

export function BrandingTab() {
  const branding = useSchoolSettingsStore((s) => s.server.branding)
  const [draft, setDraft] = useState<BrandingDraft>(draftFromServer(branding, '#0f766e'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Logo/favicon state mirrors the SERVER values (uploads save immediately).
  const logoUrl = branding?.logoUrl ?? null
  const faviconUrl = branding?.faviconUrl ?? null
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  // Re-seed the color draft when the server record (re)loads.
  useEffect(() => {
    setDraft(draftFromServer(branding, '#0f766e'))
    setError(null)
  }, [branding])

  const contrastIssue = useMemo(() => primaryContrastIssue(draft.primaryColor), [draft.primaryColor])
  const ratio = useMemo(
    () => (isValidHexColor(draft.primaryColor) ? contrastOnWhite(draft.primaryColor) : null),
    [draft.primaryColor],
  )

  const baseline = branding
    ? JSON.stringify({ primaryColor: branding.primaryColor, accentColor: branding.accentColor })
    : null
  const dirty = baseline !== null && JSON.stringify(draft) !== baseline
  const saveBlocked = !!contrastIssue

  const set = (patch: Partial<BrandingDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const handleSave = async () => {
    if (contrastIssue) {
      toast.error(contrastIssue)
      return
    }
    setSaving(true)
    setError(null)
    const result = await patchSchoolSettings({
      branding: { primaryColor: draft.primaryColor, accentColor: draft.accentColor },
    })
    setSaving(false)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success('Branding saved', {
        description: 'Colors apply to the public website, login screen and printed documents.',
      })
    } else {
      setError(result.error)
      toast.error(result.error ?? 'Branding could not be saved.')
    }
  }

  /** Upload a logo/favicon and PATCH the file id onto the school record. */
  const handleAssetUpload = async (kind: 'logo' | 'favicon', file: File) => {
    setUploading(kind)
    const up = await uploadWebsiteImage(file)
    if (!up.ok || !up.fileId) {
      setUploading(null)
      toast.error(up.error ?? 'Upload failed. Please try again.')
      return
    }
    const result = await patchSchoolSettings({ branding: { [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: up.fileId } })
    setUploading(null)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success(kind === 'logo' ? 'School logo updated' : 'Favicon updated')
    } else {
      toast.error(result.error ?? 'The uploaded file could not be attached.')
    }
  }

  const handleAssetRemove = async (kind: 'logo' | 'favicon') => {
    setUploading(kind)
    const result = await patchSchoolSettings({ branding: { [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: null } })
    setUploading(null)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success(kind === 'logo' ? 'School logo removed' : 'Favicon removed')
    } else {
      toast.error(result.error ?? 'The logo could not be removed.')
    }
  }

  const assetPreviewUrl = (fileId: string | null): string | null =>
    fileId ? `/api/public/website/media/${fileId}` : null

  return (
    <SyncGate>
      <SettingsTab
        icon={Palette}
        title="School Branding"
        description="Colors, logo and favicon used by the public website, login screen and official documents."
        action={<SyncChip dirty={dirty} saving={saving} />}
      >
        {/* ── Colors ─────────────────────────────────────────────────── */}
        <FieldGroup label="Brand Colors">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
              <Label htmlFor="branding-primary-hex" className="text-xs font-semibold block">
                Primary Color
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Primary color picker"
                  value={isValidHexColor(draft.primaryColor) ? draft.primaryColor : '#0f766e'}
                  onChange={(e) => set({ primaryColor: e.target.value })}
                  className="h-10 w-12 shrink-0 rounded-lg border border-border bg-card cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Input
                  id="branding-primary-hex"
                  value={draft.primaryColor}
                  onChange={(e) => set({ primaryColor: e.target.value.trim() })}
                  placeholder="#0f766e"
                  className="font-mono"
                  maxLength={7}
                  aria-describedby="branding-primary-hint"
                />
              </div>
              <p id="branding-primary-hint" className="text-[11px] text-muted-foreground">
                Buttons, headings and accents. Must stay readable on white surfaces.
                {ratio !== null && (
                  <> Current contrast: <strong className="tabular-nums">{ratio.toFixed(1)}:1</strong> (min {PRIMARY_CONTRAST_MIN}:1).</>
                )}
              </p>
              {contrastIssue && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
                  <span>{contrastIssue}</span>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1" aria-hidden>
                <span
                  className="inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold text-white shadow-sm"
                  style={{ background: isValidHexColor(draft.primaryColor) ? draft.primaryColor : '#0f766e' }}
                >
                  Primary preview
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
              <Label htmlFor="branding-accent-hex" className="text-xs font-semibold block">
                Accent Color
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Accent color picker"
                  value={isValidHexColor(draft.accentColor) ? draft.accentColor : '#f59e0b'}
                  onChange={(e) => set({ accentColor: e.target.value })}
                  className="h-10 w-12 shrink-0 rounded-lg border border-border bg-card cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Input
                  id="branding-accent-hex"
                  value={draft.accentColor}
                  onChange={(e) => set({ accentColor: e.target.value.trim() })}
                  placeholder="#f59e0b"
                  className="font-mono"
                  maxLength={7}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Highlights, badges and secondary accents. No contrast rule is enforced — pair it
                responsibly with the primary.
              </p>
              <div className="flex items-center gap-2 pt-1" aria-hidden>
                <span
                  className="inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold text-white shadow-sm"
                  style={{ background: isValidHexColor(draft.accentColor) ? draft.accentColor : '#f59e0b' }}
                >
                  Accent preview
                </span>
                <span
                  className="inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold shadow-sm border"
                  style={{
                    borderColor: isValidHexColor(draft.accentColor) ? draft.accentColor : '#f59e0b',
                    color: isValidHexColor(draft.accentColor) ? draft.accentColor : '#f59e0b',
                  }}
                >
                  Outline preview
                </span>
              </div>
            </div>
          </div>
        </FieldGroup>

        {/* ── Logo & Favicon ─────────────────────────────────────────── */}
        <FieldGroup label="Logo & Favicon">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([
              {
                kind: 'logo' as const,
                title: 'School Logo',
                hint: 'Shown on the public website, login screen and printed documents.',
                preview: logoUrl,
                inputRef: logoInputRef,
              },
              {
                kind: 'favicon' as const,
                title: 'Favicon',
                hint: 'Optional browser-tab icon (square images work best).',
                preview: faviconUrl,
                inputRef: faviconInputRef,
              },
            ]).map(({ kind, title, hint, preview, inputRef }) => {
              const url = assetPreviewUrl(preview)
              const busy = uploading === kind
              return (
                <div key={kind} className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                  <Label className="text-xs font-semibold block">{title}</Label>
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40',
                        kind === 'favicon' && 'h-12 w-12 rounded-lg',
                      )}
                    >
                      {url && preview ? (
                        <img src={url} alt={`${title} preview`} className="h-full w-full object-contain" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-muted-foreground/50" aria-hidden />
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) void handleAssetUpload(kind, file)
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                        className="h-8 text-xs gap-1.5 w-fit"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        {url ? 'Replace' : 'Upload'}
                      </Button>
                      {url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleAssetRemove(kind)}
                          className="h-8 text-xs gap-1 w-fit text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                        >
                          <X className="h-3.5 w-3.5" /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <Info className="h-3 w-3 mt-px shrink-0" aria-hidden />
                    {hint} JPG / PNG / WebP, max 4 MB. Uploads save immediately.
                  </p>
                </div>
              )
            })}
          </div>
        </FieldGroup>

        {/* ── Error banner + Save ─────────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
          <p className="text-[11px] text-muted-foreground">
            Logo and favicon changes save on upload — only the color pair needs Save.
          </p>
          <Button
            size="sm"
            disabled={saving || !dirty || saveBlocked}
            onClick={handleSave}
            className={cn('gap-1.5 text-xs font-bold', 'bg-emerald-600 hover:bg-emerald-700 text-white')}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save Branding'}
          </Button>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}
