'use client'

/**
 * ApplicationsModule — Principal entry point for Applications & Forms.
 *
 * TOUR-1: exactly ONE built-in form (Educational Tour — Parent Consent
 * Form). Internal view state keeps everything inside ONE module surface —
 * dashboard ⇄ session configuration ⇄ submissions management — no browser
 * routes, exactly like the Fees / Salary shells. Every action flows through
 * applications-store and (for money) fee-store pipelines.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApplicationsStore, ensureApplicationSeedData, type TourDocTemplate } from '@/lib/store/applications-store'
import type { SchoolApplication } from '@/lib/store/applications-store'
import { PageTransition } from '@/components/shared/ui'
import { DemoModuleNotice } from '../shared/demo-module-notice'
import { ApplicationsDashboard } from './applications-dashboard'
import { TourConfigScreen } from './tour-config'
import { TourSubmissions } from './tour-submissions'

const ACTOR = 'Dr. Ananya Iyer'

type View =
  | { name: 'dashboard' }
  | { name: 'config'; editingId?: string; template?: TourDocTemplate }
  | { name: 'detail'; appId: string }

export function ApplicationsModule() {
  const [view, setView] = useState<View>({ name: 'dashboard' })

  // Seed realistic submissions from the canonical roster on first paint.
  // Idempotent: only acts while both collections are empty.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (!seeded) {
      ensureApplicationSeedData()
      setSeeded(true)
    }
  }, [seeded])

  return (
    <div data-testid="applications-module">
      <PageTransition className="space-y-4">
        {/* 7-I — honest label: client-side demo state, no server API.
            Mounted once at the module root so every view (dashboard /
            config / submissions) carries it. */}
        <div className="max-w-7xl mx-auto">
          <DemoModuleNotice moduleName="Applications & Forms" />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={view.name + ('appId' in view ? view.appId : '') + ('editingId' in view ? view.editingId ?? '' : '')}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="max-w-7xl mx-auto"
          >
            {view.name === 'dashboard' && (
              <ApplicationsDashboard
                onOpenApplication={(id) => setView({ name: 'detail', appId: id })}
                onUseTemplate={(docTemplate) => setView({ name: 'config', template: docTemplate })}
                onEditSession={(id) => setView({ name: 'config', editingId: id })}
              />
            )}
            {view.name === 'config' && (
              <ConfigHost
                editingId={view.editingId}
                initialTemplate={view.template}
                onBack={() => setView({ name: 'dashboard' })}
                onSaved={(id) => setView({ name: 'config', editingId: id })}
                onPublished={(id) => setView({ name: 'detail', appId: id })}
              />
            )}
            {view.name === 'detail' && (
              <DetailHost
                appId={view.appId}
                onBack={() => setView({ name: 'dashboard' })}
                onEdit={(id) => setView({ name: 'config', editingId: id })}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </PageTransition>
    </div>
  )
}

function ConfigHost({ editingId, initialTemplate, onBack, onSaved, onPublished }: {
  editingId?: string
  initialTemplate?: TourDocTemplate
  onBack: () => void
  onSaved: (id: string) => void
  onPublished: (id: string) => void
}) {
  const editing = useApplicationsStore((s) => (editingId ? s.applications.find((a) => a.id === editingId) : undefined))
  if (editingId && !editing) {
    onBack()
    return null
  }
  return (
    <TourConfigScreen
      editing={editing}
      initialTemplate={initialTemplate}
      actorRole="Principal"
      actorName={ACTOR}
      onBack={onBack}
      onSaved={onSaved}
      onPublished={onPublished}
    />
  )
}

function DetailHost({ appId, onBack, onEdit }: {
  appId: string
  onBack: () => void
  onEdit: (id: string) => void
}) {
  const app = useApplicationsStore((s) => s.applications.find((a) => a.id === appId))
  if (!app) {
    onBack()
    return null
  }
  const live: SchoolApplication = app
  return (
    <TourSubmissions
      key={live.id}
      app={live}
      onBack={onBack}
      onEdit={() => onEdit(live.id)}
    />
  )
}
