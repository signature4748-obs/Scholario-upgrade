'use client'

/**
 * Website Management — Facilities section (task 2-a).
 * Editor for the websiteContent `facilities` section (campus facility
 * cards), adapted from website-tab.tsx.
 */

import { useEffect, useState } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/shared/ui'
import {
  type WebsiteContent, type FacilityItem,
} from '@/lib/website-content'
import {
  SectionCard, FieldRow, ListEditor, useWebsiteContent, useSectionState, SectionProps,
  ModuleLoading, ModuleError,
} from './shared'

function FacilitiesEditor({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.facilities)
  useEffect(() => { setDraft(content.facilities) }, [content.facilities])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.facilities)
  const set = (patch: Partial<WebsiteContent['facilities']>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <SectionCard
      icon={BookOpen}
      title="Campus Facilities"
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

export function FacilitiesSection() {
  const { content, setContent, state, error, reload } = useWebsiteContent()
  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">Facilities</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              The campus-facility cards rendered on the public website.
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
      {state === 'loaded' && content && <FacilitiesEditor content={content} onSaved={setContent} />}
    </div>
  )
}
