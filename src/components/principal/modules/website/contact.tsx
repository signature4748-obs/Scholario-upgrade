'use client'

/**
 * Website Management — Contact section (task 2-a).
 * Editors for the websiteContent `contact` (heading/sub-line), `footer`
 * (about line + legacy social links) and `seo` (page title/description)
 * sections, adapted from website-tab.tsx.
 */

import { useEffect, useState } from 'react'
import { MapPin, Globe, Search, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/shared/ui'
import {
  SectionCard, FieldRow, useWebsiteContent, useSectionState, SectionProps,
  ModuleLoading, ModuleError,
} from './shared'

const SOCIAL_KEYS = ['facebook', 'instagram', 'youtube', 'twitter', 'linkedin'] as const

function ContactEditor({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.contact)
  useEffect(() => { setDraft(content.contact) }, [content.contact])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.contact)

  return (
    <SectionCard
      icon={MapPin}
      title="Contact Block"
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

function FooterEditor({ content, onSaved }: SectionProps) {
  const { saving, error, saveSection } = useSectionState()
  const [draft, setDraft] = useState(content.footer)
  useEffect(() => { setDraft(content.footer) }, [content.footer])
  const dirty = JSON.stringify(draft) !== JSON.stringify(content.footer)

  return (
    <SectionCard
      icon={Globe}
      title="Footer"
      description="Footer about line. (Managed social links live in the Social Links section.)"
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

function SeoEditor({ content, onSaved }: SectionProps) {
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

export function ContactSection() {
  const { content, setContent, state, error, reload } = useWebsiteContent()
  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">Contact &amp; Footer</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Contact-block copy, the footer line and search-engine metadata.
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
          <ContactEditor content={content} onSaved={setContent} />
          <FooterEditor content={content} onSaved={setContent} />
          <SeoEditor content={content} onSaved={setContent} />
        </>
      )}
    </div>
  )
}
