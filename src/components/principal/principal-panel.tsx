'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  LayoutDashboard, UserPlus, GraduationCap, School, CalendarCheck, IndianRupee,
  Wallet, FileText, Megaphone, CalendarDays, ClipboardList,
  BookMarked, Bus, Package, Award, Settings, MessageSquare,
  PieChart, Download, Clock
} from 'lucide-react'
import { AppShell, type NavGroup } from '@/components/shell/app-shell'
import { lazyModule } from '@/components/shared/lazy-module'
import { useLiveAlerts } from '@/lib/store/live-alerts-store'
import { useAdmissionStore } from '@/lib/store/admission-store'
// SaaS-STAGE-2A — TENANT MODULE GATING (single choke point). The nav is
// filtered through the ACTIVE school's module flags via the canonical
// PRINCIPAL_NAV_MODULE_KEYS map — no scattered school conditionals.
import { useFeatureGate } from '@/lib/tenant/store'
import { PRINCIPAL_NAV_MODULE_KEYS } from '@/lib/tenant/registry'
// PHASE 7.5-D — the SERVER module flags (GET /api/school-settings
// moduleFlags; server vocabulary exams/fees/homework/library/transport)
// are the truth. The registry's client `features` (all-on seeds, zero
// writers) stay as a decorative AND-gate; the server flag hides a
// flaggable module's nav item when it is disabled platform-side.
// Fail-open while the flags are still loading (matches the server design).
import { useEffectiveModuleFlags } from '@/lib/hooks/use-effective-module-flags'
import type { UnifiedTab } from './modules/students-classes'

// Every module is a separate lazily-loaded chunk: navigating compiles just
// that module (small memory spikes) instead of one giant principal bundle.
// Chunk-resilient lazy loader: import retry + per-module error boundary
// (stabilization §22/§29 — a failed chunk must never blank the app).
const lazy = (loader: () => Promise<{ [key: string]: any }>, pick: string) =>
  lazyModule(loader, pick)

// Wave 1 scope: Homework & Assignments are intentionally deferred from the
// Principal role. They will be rebuilt as a connected Teacher → Student →
// Parent → Principal ecosystem in a future phase. Code preserved for reuse.

const PrincipalDashboard = lazy(() => import('./modules/dashboard'), 'PrincipalDashboard')
const StudentsClassesModule = lazy(() => import('./modules/students-classes'), 'StudentsClassesModule')
const TeachersModule = lazy(() => import('./modules/teachers'), 'TeachersModule')
const FeesModule = lazy(() => import('./modules/fees'), 'FeesModule')
const FinanceDashboardModule = lazy(() => import('./modules/finance-dashboard'), 'FinanceDashboardModule')

const moduleRegistry: Record<string, React.ComponentType<any>> = {
  dashboard: PrincipalDashboard,
  admission: lazy(() => import('./modules/admission'), 'AdmissionModule'),
  teachers: TeachersModule,
  students: StudentsClassesModule,
  'students:overview': StudentsClassesModule,
  'students:directory': StudentsClassesModule,
  'students:classes': StudentsClassesModule,
  classes: StudentsClassesModule,
  timetable: lazy(() => import('./modules/timetable'), 'TimetableModule'),
  attendance: lazy(() => import('./modules/attendance'), 'AttendanceModule'),
  fees: FeesModule,
  applications: lazy(() => import('./modules/applications/applications-module'), 'ApplicationsModule'),
  salary: lazy(() => import('./modules/salary'), 'SalaryModule'),
  finance: FinanceDashboardModule,
  exams: lazy(() => import('./modules/exams'), 'ExamsModule'),
  // homework / assignments: deferred (Wave 1) — see note above.
  communication: lazy(() => import('./modules/communication'), 'CommunicationModule'),
  messaging: lazy(() => import('./modules/messaging'), 'MessagingModule'),
  calendar: lazy(() => import('./modules/calendar'), 'CalendarModule'),
  library: lazy(() => import('./modules/library'), 'LibraryModule'),
  transport: lazy(() => import('./modules/transport'), 'TransportModule'),
  inventory: lazy(() => import('./modules/inventory'), 'InventoryModule'),
  certificates: lazy(() => import('./modules/certificates'), 'CertificatesModule'),
  downloads: lazy(() => import('./modules/downloads'), 'DownloadsModule'),
  settings: lazy(() => import('./modules/school-settings'), 'SchoolSettingsModule'),
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4.5 w-4.5" /> },
    ],
  },
  {
    label: 'Academics',
    items: [
      { key: 'admission', label: 'Admissions', icon: <UserPlus className="h-4.5 w-4.5" /> },
      { key: 'teachers', label: 'Teachers', icon: <GraduationCap className="h-4.5 w-4.5" /> },
      { key: 'students', label: 'Students & Classes', icon: <School className="h-4.5 w-4.5" /> },
      { key: 'timetable', label: 'Timetable', icon: <Clock className="h-4.5 w-4.5" /> },
      { key: 'attendance', label: 'Attendance', icon: <CalendarCheck className="h-4.5 w-4.5" /> },
      { key: 'exams', label: 'Examinations', icon: <FileText className="h-4.5 w-4.5" /> },
      // { key: 'homework', label: 'Homework', icon: <BookOpen className="h-4.5 w-4.5" /> },        // Wave 1: deferred
      // { key: 'assignments', label: 'Assignments', icon: <ClipboardList className="h-4.5 w-4.5" /> }, // Wave 1: deferred
    ],
  },
  {
    label: 'Finance',
    items: [
      { key: 'fees', label: 'Fee Management', icon: <IndianRupee className="h-4.5 w-4.5" /> },
      { key: 'salary', label: 'Salary & Payroll', icon: <Wallet className="h-4.5 w-4.5" /> },
      { key: 'finance', label: 'Finance Dashboard', icon: <PieChart className="h-4.5 w-4.5" /> },
    ],
  },
  {
    label: 'Operations',
    items: [
      { key: 'applications', label: 'Applications & Forms', icon: <ClipboardList className="h-4.5 w-4.5" /> },
      { key: 'communication', label: 'Communication', icon: <Megaphone className="h-4.5 w-4.5" /> },
      { key: 'messaging', label: 'Messages', icon: <MessageSquare className="h-4.5 w-4.5" /> },
      { key: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-4.5 w-4.5" /> },
      { key: 'library', label: 'Library', icon: <BookMarked className="h-4.5 w-4.5" /> },
      { key: 'transport', label: 'Transport', icon: <Bus className="h-4.5 w-4.5" /> },
      { key: 'inventory', label: 'Inventory', icon: <Package className="h-4.5 w-4.5" /> },
      { key: 'certificates', label: 'Certificates', icon: <Award className="h-4.5 w-4.5" /> },
      { key: 'downloads', label: 'Downloads', icon: <Download className="h-4.5 w-4.5" /> },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'settings', label: 'Settings', icon: <Settings className="h-4.5 w-4.5" /> },
    ],
  },
]

// Per-tab module memory (sessionStorage) — same pattern as the Teacher
// panel: a lazy-chunk recovery reload (stale chunk graph after a dev
// recompile / server restart) must land the principal back on the module
// they opened, not silently reset them to the dashboard. The memory dies
// with the tab; an explicit ?module= deep-link always wins.
const MODULE_MEMORY_KEY = 'scholario-principal-module'

function initialActiveModule(): string {
  if (typeof window === 'undefined') return 'dashboard'
  // ?module=<key> deep-link — lets a bookmark (or a colleague-shared link)
  // open a specific module directly. The value must exist in the registry;
  // anything else falls through to the memory / dashboard.
  const requested = new URLSearchParams(window.location.search).get('module')
  if (requested && moduleRegistry[requested]) return requested
  try {
    const remembered = window.sessionStorage.getItem(MODULE_MEMORY_KEY)
    if (remembered && moduleRegistry[remembered]) return remembered
  } catch {
    /* storage disabled (private mode) — honest fallback */
  }
  return 'dashboard'
}

export function PrincipalPanel() {
  const [active, setActive] = useState(initialActiveModule)
  const alertCount = useLiveAlerts((s) => s.alerts.length)
  const { isModuleEnabled } = useFeatureGate()
  const { isServerModuleEnabled } = useEffectiveModuleFlags()
  const pendingAdmissions = useAdmissionStore((s) =>
    s.applications.filter((a) =>
      a.status === 'Submitted' || a.status === 'Under Review' || a.status === 'Need Correction'
    ).length
  )

  // Seed applications demo data once per session (idempotent).

  const groups: NavGroup[] = useMemo(() => navGroups
    // SaaS-STAGE-2A — drop nav items whose module is disabled for the
    // ACTIVE school (e.g. Examinations OFF for a school, Transport OFF for
    // another). Dashboard/Settings are always available.
    // PHASE 7.5-D — the item must ALSO pass the SERVER module flag
    // (fail-open while the flags load; hidden once the server says off).
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const moduleKey = PRINCIPAL_NAV_MODULE_KEYS[item.key]
        return !moduleKey || (isModuleEnabled(moduleKey) && isServerModuleEnabled(moduleKey))
      }),
    }))
    .map((g) => {
      if (g.label === 'Overview') {
        return { ...g, items: g.items.map((item) => item.key === 'dashboard' ? { ...item, badge: alertCount > 0 ? alertCount : undefined } : item) }
      }
      if (g.label === 'Academics') {
        return { ...g, items: g.items.map((item) => item.key === 'admission' ? { ...item, badge: pendingAdmissions > 0 ? pendingAdmissions : undefined } : item) }
      }
      return g
    }), [alertCount, pendingAdmissions, isModuleEnabled, isServerModuleEnabled])

  // Remember the open module for this tab (see initialActiveModule) — a
  // lazy-chunk recovery reload then re-opens exactly where the principal
  // was instead of silently bouncing to the dashboard.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(MODULE_MEMORY_KEY, active)
    } catch {
      /* storage disabled — nothing to remember */
    }
  }, [active])

  // Consume the ?module= deep-link once (strip it from the URL) so later
  // in-app navigation isn't shadowed by the stale param on the next
  // recovery reload — the per-tab memory takes over from here.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.has('module')) {
      url.searchParams.delete('module')
      window.history.replaceState(null, '', url.toString())
    }
  }, [])

  // If the active module gets disabled while viewing it (platform toggle
  // + tenant switch — client registry flag OR the server's effective
  // moduleFlags arriving mid-session), fall back to the dashboard — never
  // render a module the school doesn't have.
  useEffect(() => {
    const moduleKey = PRINCIPAL_NAV_MODULE_KEYS[active]
    if (moduleKey && (!isModuleEnabled(moduleKey) || !isServerModuleEnabled(moduleKey))) {
      setActive('dashboard')
    }
  }, [active, isModuleEnabled, isServerModuleEnabled])

  const ActiveModule = moduleRegistry[active] ?? PrincipalDashboard

  let initialTab: UnifiedTab = 'overview'
  if (active === 'students:directory') initialTab = 'directory'
  else if (active === 'students:classes' || active === 'classes') initialTab = 'classes'
  else if (active === 'students:archived') initialTab = 'archived'

  const isStudentModule = active === 'students' || active.startsWith('students:') || active === 'classes'

  return (
    <AppShell
      groups={groups}
      activeKey={isStudentModule ? 'students' : active}
      onNavigate={setActive}
      role="principal"
      roleLabel="Principal · Admin"
    >
      {isStudentModule ? (
        <StudentsClassesModule initialTab={initialTab} />
      ) : active === 'dashboard' ? (
        <PrincipalDashboard onNavigate={setActive} />
      ) : active === 'fees' ? (
        // Fees receives cross-module navigation so the Fee Structure editor
        // can deep-link to the Examination module ("Go to Examinations" —
        // the source of truth for exam definitions).
        <FeesModule onNavigate={setActive} />
      ) : active === 'finance' ? (
        // Finance Dashboard gets cross-module navigation so its Receivables
        // "View" and Fee/Payroll quick-nav cards jump to the real modules
        // instead of dead toasts.
        <FinanceDashboardModule onModuleNavigate={setActive} />
      ) : (
        <ActiveModule />
      )}
    </AppShell>
  )
}
