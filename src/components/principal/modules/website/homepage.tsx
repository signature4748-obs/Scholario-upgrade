'use client'

/**
 * Website Management — Homepage section (task 2-a).
 *
 * The landing-page editors ADAPTED from the settings Website tab
 * (website-tab.tsx): Hero, Pillars and the Principal's Message. Each card
 * saves JUST its section through PATCH /api/school/website (partial-
 * section semantics preserved — sections present in the body replace the
 * stored value, absent sections keep theirs).
 */

import { useEffect, useState } from 'react'
import { Globe, Trophy, Megaphone, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { GlassCard } from '@/components/shared/ui'
import {
  type WebsiteContent,
  type PillarItem,
  type CtaConfig,
} from '@/lib/website-content'
import {
  SectionCard, FieldRow, ListEditor, useWebsiteContent, useSectionState, SectionProps,
  ModuleLoading, ModuleError,
} from './shared'

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

function PillarsSection({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState<PillarItem[]>(content.pillars)
  useEffect(() => { setDraft(content.pillars) }, [content.pillars])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.pillars)

  return (
    <SectionCard
      icon={Trophy}
      title="Pillars"
      description="The value-proposition cards shown under the hero. State only real strengths."
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

export function HomepageSection() {
  const { content, setContent, state, error, reload } = useWebsiteContent()

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">Homepage</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              The landing banner, pillars and principal&apos;s message. Every card saves independently and the public site updates immediately.
            </p>
          </div>
          {state === 'loaded' && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void reload()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          )}
        </div>
      </GlassCard>

      {state === 'loading' && <ModuleLoading />}
      {state === 'error' && <ModuleError message={error ?? ''} onRetry={() => void reload()} title="Website content could not be loaded" />}
      {state === 'loaded' && content && (
        <>
          <HeroSection content={content} onSaved={setContent} />
          <PillarsSection content={content} onSaved={setContent} />
          <PrincipalMessageSection content={content} onSaved={setContent} />
        </>
      )}
    </div>
  )
}
