'use client'

/**
 * TransportModule — Principal Transport workspace orchestrator.
 *
 * Visual shell follows the Academics (Examinations + Attendance) canonical
 * pattern:
 *   <PageTransition className="space-y-4">
 *     <div className="flex items-center justify-between gap-3 flex-wrap">
 *       <SegmentedTabs ... />            ← left
 *       <Button>Assign Student</Button>  ← right (primary, solid emerald)
 *     </div>
 *     <AnimatePresence mode="wait">
 *       {tab === 'routes' && <motion.div key="routes" ...><RoutesTable /></motion.div>}
 *       ...
 *     </AnimatePresence>
 *   </PageTransition>
 *
 * NO sticky header, NO eyebrow, NO h1, NO summary pill line — the sidebar
 * already names the module, and the per-tab content (panel subtitles, tab
 * badges) is the single home for each metric.
 *
 * Layout:
 *   - Tab row: Routes · Vehicles · Users · Maintenance · Reports (left)
 *              + Assign Student button (right)
 *   - Active tab panel:
 *       * routes      → RoutesTable
 *       * vehicles    → VehiclesTable
 *       * users       → UnassignedStudentsBanner + AssignmentsTable
 *       * maintenance → MaintenancePanel
 *       * reports     → TransportReports (Route Distribution + Capacity Utilization)
 *   - Dialogs: AssignStudentDialog, ChangeRouteDialog, RemoveAssignmentConfirm
 *
 * State from `useTransportStore` + `useTransportData` hooks. Students come
 * from the canonical `useStudentsStore` — no duplicate student data lives
 * in the transport store. Keyboard shortcuts 1-5.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bus, Route as RouteIcon, Users, Wrench, FileBarChart2, UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '../shared/segmented-tabs'
import {
  useTransportStore,
  useTransportData,
} from '@/lib/store/transport-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import type { TransportAssignment } from '@/lib/store/transport-store'
import {
  TPT_GLOBAL_STYLES,
  type TptTab,
} from './transport-shared'
import { DemoModuleNotice } from '../shared/demo-module-notice'
import { RoutesTable } from './routes-table'
import { VehiclesTable } from './vehicles-table'
import {
  AssignmentsTable,
  AssignStudentDialog,
  ChangeRouteDialog,
  RemoveAssignmentConfirm,
  UnassignedStudentsBanner,
} from './transport-users'
import { MaintenancePanel } from './maintenance-panel'
import { TransportReports } from './transport-charts'

const TABS: Array<{ value: TptTab; label: string; icon: React.ReactNode; badge?: number }> = [
  { value: 'routes', label: 'Routes', icon: <RouteIcon className="h-3.5 w-3.5" /> },
  { value: 'vehicles', label: 'Vehicles', icon: <Bus className="h-3.5 w-3.5" /> },
  { value: 'users', label: 'Users', icon: <Users className="h-3.5 w-3.5" /> },
  { value: 'maintenance', label: 'Maintenance', icon: <Wrench className="h-3.5 w-3.5" /> },
  { value: 'reports', label: 'Reports', icon: <FileBarChart2 className="h-3.5 w-3.5" /> },
]

export function TransportModule() {
  const [tab, setTab] = useState<TptTab>('routes')
  const [assignOpen, setAssignOpen] = useState(false)
  const [changeRouteOpen, setChangeRouteOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [changeRouteTarget, setChangeRouteTarget] = useState<TransportAssignment | null>(null)
  const [removeTarget, setRemoveTarget] = useState<TransportAssignment | null>(null)

  // FINAL-GATE (EG-9F/R4) — apply the demo tenant's sanctioned seed corpus
  // once (module root); a real tenant keeps the honest empty state.
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useTransportStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  const data = useTransportData()
  const { analytics } = data

  // Tab badges — maintenance shows due+overdue count, users shows unassigned.
  // SegmentedTabs suppresses rendering when 0.
  const tabsWithBadges = TABS.map((t) => {
    const badgeMap: Partial<Record<TptTab, number>> = {
      maintenance: analytics.maintenanceDue.length,
      users: analytics.unassignedStudents,
    }
    return { ...t, badge: badgeMap[t.value] }
  })

  // Keyboard shortcuts: 1-5 switch tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '5') {
        const idx = Number(e.key) - 1
        if (idx < TABS.length) {
          e.preventDefault()
          setTab(TABS[idx].value)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const openChangeRoute = (a: TransportAssignment) => {
    setChangeRouteTarget(a)
    setChangeRouteOpen(true)
  }

  const openRemove = (a: TransportAssignment) => {
    setRemoveTarget(a)
    setRemoveOpen(true)
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: TPT_GLOBAL_STYLES }} />
      <PageTransition className="space-y-4 transport-shell">
      {/* 7-I — honest label: the UI runs client-side demo state (real
          read-only GET APIs exist, writes are demo-only). */}
      <DemoModuleNotice moduleName="Transport" variant="preview" />

      {/* Tab row + Assign Student action on the right */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedTabs
          tabs={tabsWithBadges}
          value={tab}
          onValueChange={(v) => setTab(v as TptTab)}
        />
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => setAssignOpen(true)}
        >
          <UserPlus className="h-3.5 w-3.5" /> Assign Student
        </Button>
      </div>

      {/* Active tab content with AnimatePresence transitions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="space-y-4"
        >
          {tab === 'routes' && <RoutesTable />}
          {tab === 'vehicles' && <VehiclesTable />}
          {tab === 'users' && (
            <>
              <UnassignedStudentsBanner
                unassignedCount={analytics.unassignedStudents}
                onAssign={() => setAssignOpen(true)}
              />
              <AssignmentsTable
                onAssign={() => setAssignOpen(true)}
                onChangeRoute={openChangeRoute}
                onRemove={openRemove}
              />
            </>
          )}
          {tab === 'maintenance' && (
            <MaintenancePanel
              onComplete={() => setTab('vehicles')}
            />
          )}
          {tab === 'reports' && <TransportReports />}
        </motion.div>
      </AnimatePresence>

      {/* Dialogs */}
      <AssignStudentDialog open={assignOpen} onOpenChange={setAssignOpen} />
      <ChangeRouteDialog
        open={changeRouteOpen}
        onOpenChange={setChangeRouteOpen}
        assignment={changeRouteTarget}
      />
      <RemoveAssignmentConfirm
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        assignment={removeTarget}
      />
      </PageTransition>
    </>
  )
}
