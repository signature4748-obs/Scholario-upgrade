'use client'

/**
 * Website Management — About School section (task 2-a).
 * Editor for the websiteContent `about` section (from website-tab.tsx).
 */

import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/shared/ui'
import {
  SectionCard, FieldRow, useWebsiteContent, useSectionState, SectionProps,
  ModuleLoading, ModuleError,
} from './shared'

function AboutEditor({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.about)
  useEffect(() => { setDraft(content.about) }, [content.about])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.about)

  return (
    <SectionCard
      icon={Sparkles}
      title="About Block"
      description="The about-block heading and sub-line (the body copy renders from your real school facts)."
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

export function AboutSection() {
  const { content, setContent, state, error, reload } = useWebsiteContent()
  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">About School</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              The About heading and sub-line on the public website.
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
      {state === 'loaded' && content && <AboutEditor content={content} onSaved={setContent} />}
    </div>
  )
}
