'use client'

/**
 * Website Management — Academics section (task 2-a).
 * Editor for the websiteContent `journey` section (programme stages by
 * grade band), adapted from website-tab.tsx.
 */

import { useEffect, useState } from 'react'
import { Compass, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/shared/ui'
import {
  type WebsiteContent, type JourneyStage,
} from '@/lib/website-content'
import {
  SectionCard, FieldRow, ListEditor, useWebsiteContent, useSectionState, SectionProps,
  ModuleLoading, ModuleError,
} from './shared'

function JourneyEditor({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.journey)
  useEffect(() => { setDraft(content.journey) }, [content.journey])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.journey)
  const set = (patch: Partial<WebsiteContent['journey']>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <SectionCard
      icon={Compass}
      title="Programme Stages"
      description="Academic stages by grade band (Primary / Middle / Senior …)."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void saveSection('journey', draft, onSaved, 'Academics section saved.')}
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

export function AcademicsSection() {
  const { content, setContent, state, error, reload } = useWebsiteContent()
  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">Academics</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              The programme-stage cards shown in the public site&apos;s Academics section.
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
      {state === 'loaded' && content && <JourneyEditor content={content} onSaved={setContent} />}
    </div>
  )
}
