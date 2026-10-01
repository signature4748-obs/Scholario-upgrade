/**
 * Transport store — connected school transport management.
 *
 * Students come from canonical Students store.
 * Drivers connect to existing staff model.
 * Routes, vehicles, assignments, maintenance all derive from this store.
 *
 * QA-FIX-B — TENANT-SCOPED PERSISTENCE: vehicles, routes, drivers,
 * assignments + maintenance survive reload (per-school namespace via
 * createTenantScopedStorage). Search is ephemeral UI state — not persisted.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo } from 'react'
import { useStudentsStore } from '@/lib/store/students-store'
import { makeDemoSeedApplier } from '@/lib/store/demo-tenant'
import { migrateLegacyScopedStore, createTenantScopedStorage } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore('scholario-transport-v1', DEFAULT_TENANT_ID)

export type VehicleType = 'Bus' | 'Mini Bus' | 'Van'
export type VehicleStatus = 'Active' | 'Maintenance' | 'Inactive'
export type RouteStatus = 'On Route' | 'At School' | 'Maintenance' | 'Inactive'
export type MaintenanceStatus = 'Due' | 'Overdue' | 'Completed' | 'Scheduled'

export interface Vehicle {
  id: string
  number: string
  type: VehicleType
  capacity: number
  driverId: string
  driverName: string
  routeId: string
  routeName: string
  status: VehicleStatus
  gps: boolean
  lastService: string
  nextService: string
  insuranceExpiry: string
}

export interface Route {
  id: string
  name: string
  startPoint: string
  destination: string
  stops: number
  vehicleId: string
  vehicleNo: string
  driverId: string
  driverName: string
  capacity: number
  enrolled: number
  status: RouteStatus
  eta: string
}

export interface Driver {
  id: string
  name: string
  phone: string
  vehicleId: string
  vehicleNo: string
  routeId: string
  routeName: string
  status: 'Active' | 'On Leave' | 'Inactive'
}

export interface TransportAssignment {
  id: string
  studentId: string
  studentName: string
  admissionNo: string
  className: string
  routeId: string
  routeName: string
  stop: string
  vehicleNo: string
  driverName: string
  status: 'Assigned' | 'Unassigned'
}

export interface MaintenanceRecord {
  id: string
  vehicleId: string
  vehicleNo: string
  type: string
  lastService: string
  nextService: string
  status: MaintenanceStatus
  issue?: string
  cost: number
}

/**
 * T4-E — route-change notice. Recorded by `changeRoute` so the affected
 * student's Transport view can show an honest "your route changed" banner
 * (dismissed explicitly via `dismissRouteChange`). Scoped by studentId so
 * a global store field never leaks another student's notice.
 */
export interface RouteChangeNotice {
  studentId: string
  newRouteName: string
  effectiveDate: string
  stop?: string
}

const SEED_VEHICLES: Vehicle[] = [
  { id: 'V01', number: 'HR-26-AB-1245', type: 'Bus', capacity: 48, driverId: 'DR-01', driverName: 'Ramesh Yadav', routeId: 'TR01', routeName: 'Route 1 — DLF Phase 1–5', status: 'Active', gps: true, lastService: '2025-10-15', nextService: '2026-01-15', insuranceExpiry: '2026-03-20' },
  { id: 'V02', number: 'HR-26-CD-2367', type: 'Bus', capacity: 48, driverId: 'DR-02', driverName: 'Mukesh Kumar', routeId: 'TR02', routeName: 'Route 2 — Sushant Lok & Sector 56', status: 'Active', gps: true, lastService: '2025-10-22', nextService: '2026-01-22', insuranceExpiry: '2026-05-10' },
  { id: 'V03', number: 'HR-26-EF-3489', type: 'Mini Bus', capacity: 42, driverId: 'DR-03', driverName: 'Suresh Singh', routeId: 'TR03', routeName: 'Route 3 — Palam Vihar & Sector 23', status: 'Active', gps: true, lastService: '2024-09-30', nextService: '2025-12-30', insuranceExpiry: '2025-12-15' },
  { id: 'V04', number: 'HR-26-GH-4512', type: 'Bus', capacity: 48, driverId: 'DR-04', driverName: 'Pradeep Sharma', routeId: 'TR04', routeName: 'Route 4 — Sohna Road & Sector 49', status: 'Active', gps: true, lastService: '2025-10-08', nextService: '2026-01-08', insuranceExpiry: '2026-02-28' },
  { id: 'V05', number: 'HR-26-IJ-5634', type: 'Mini Bus', capacity: 42, driverId: 'DR-05', driverName: 'Anil Verma', routeId: 'TR05', routeName: 'Route 5 — Sector 14 & 15', status: 'Maintenance', gps: false, lastService: '2025-09-20', nextService: '2025-12-20', insuranceExpiry: '2026-01-05' },
  { id: 'V06', number: 'HR-26-KL-6756', type: 'Bus', capacity: 48, driverId: 'DR-06', driverName: 'Dinesh Patel', routeId: 'TR06', routeName: 'Route 6 — Sector 40 & 42', status: 'Active', gps: true, lastService: '2025-11-01', nextService: '2026-02-01', insuranceExpiry: '2026-04-20' },
]

const SEED_ROUTES: Route[] = [
  { id: 'TR01', name: 'Route 1 — DLF Phase 1–5', startPoint: 'DLF Phase 1', destination: 'School', stops: 8, vehicleId: 'V01', vehicleNo: 'HR-26-AB-1245', driverId: 'DR-01', driverName: 'Ramesh Yadav', capacity: 48, enrolled: 42, status: 'On Route', eta: '14 min' },
  { id: 'TR02', name: 'Route 2 — Sushant Lok & Sector 56', startPoint: 'Sushant Lok', destination: 'School', stops: 7, vehicleId: 'V02', vehicleNo: 'HR-26-CD-2367', driverId: 'DR-02', driverName: 'Mukesh Kumar', capacity: 48, enrolled: 38, status: 'On Route', eta: '22 min' },
  { id: 'TR03', name: 'Route 3 — Palam Vihar & Sector 23', startPoint: 'Palam Vihar', destination: 'School', stops: 6, vehicleId: 'V03', vehicleNo: 'HR-26-EF-3489', driverId: 'DR-03', driverName: 'Suresh Singh', capacity: 42, enrolled: 36, status: 'At School', eta: '0 min' },
  { id: 'TR04', name: 'Route 4 — Sohna Road & Sector 49', startPoint: 'Sohna Road', destination: 'School', stops: 9, vehicleId: 'V04', vehicleNo: 'HR-26-GH-4512', driverId: 'DR-04', driverName: 'Pradeep Sharma', capacity: 48, enrolled: 44, status: 'On Route', eta: '18 min' },
  { id: 'TR05', name: 'Route 5 — Sector 14 & 15', startPoint: 'Sector 14', destination: 'School', stops: 5, vehicleId: 'V05', vehicleNo: 'HR-26-IJ-5634', driverId: 'DR-05', driverName: 'Anil Verma', capacity: 42, enrolled: 32, status: 'Maintenance', eta: '—' },
  { id: 'TR06', name: 'Route 6 — Sector 40 & 42', startPoint: 'Sector 40', destination: 'School', stops: 7, vehicleId: 'V06', vehicleNo: 'HR-26-KL-6756', driverId: 'DR-06', driverName: 'Dinesh Patel', capacity: 48, enrolled: 40, status: 'On Route', eta: '12 min' },
]

const SEED_DRIVERS: Driver[] = [
  { id: 'DR-01', name: 'Ramesh Yadav', phone: '+91 98100 11111', vehicleId: 'V01', vehicleNo: 'HR-26-AB-1245', routeId: 'TR01', routeName: 'Route 1', status: 'Active' },
  { id: 'DR-02', name: 'Mukesh Kumar', phone: '+91 98200 22222', vehicleId: 'V02', vehicleNo: 'HR-26-CD-2367', routeId: 'TR02', routeName: 'Route 2', status: 'Active' },
  { id: 'DR-03', name: 'Suresh Singh', phone: '+91 98300 33333', vehicleId: 'V03', vehicleNo: 'HR-26-EF-3489', routeId: 'TR03', routeName: 'Route 3', status: 'Active' },
  { id: 'DR-04', name: 'Pradeep Sharma', phone: '+91 98400 44444', vehicleId: 'V04', vehicleNo: 'HR-26-GH-4512', routeId: 'TR04', routeName: 'Route 4', status: 'Active' },
  { id: 'DR-05', name: 'Anil Verma', phone: '+91 98500 55555', vehicleId: 'V05', vehicleNo: 'HR-26-IJ-5634', routeId: 'TR05', routeName: 'Route 5', status: 'On Leave' },
  { id: 'DR-06', name: 'Dinesh Patel', phone: '+91 98600 66666', vehicleId: 'V06', vehicleNo: 'HR-26-KL-6756', routeId: 'TR06', routeName: 'Route 6', status: 'Active' },
]

// Build assignments from canonical students (those with transport=true)
function buildAssignments(): TransportAssignment[] {
  const students = useStudentsStore.getState().students.filter((s) => s.status === 'Active' && s.transport)
  return students.slice(0, 30).map((s, i) => {
    const routeIdx = i % SEED_ROUTES.length
    const route = SEED_ROUTES[routeIdx]
    return {
      id: `TA${String(i + 1).padStart(3, '0')}`,
      studentId: s.id,
      studentName: s.name,
      admissionNo: s.admissionNo,
      className: `${s.className}-${s.section}`,
      routeId: route.id,
      routeName: route.name,
      stop: `Stop ${Math.floor(i / SEED_ROUTES.length) + 1}`,
      vehicleNo: route.vehicleNo,
      driverName: route.driverName,
      status: 'Assigned',
    }
  })
}

const SEED_MAINTENANCE: MaintenanceRecord[] = [
  { id: 'MN01', vehicleId: 'V03', vehicleNo: 'HR-26-EF-3489', type: 'Annual Service', lastService: '2024-09-30', nextService: '2025-12-30', status: 'Overdue', issue: 'Engine noise during cold start', cost: 0 },
  { id: 'MN02', vehicleId: 'V05', vehicleNo: 'HR-26-IJ-5634', type: 'Brake Service', lastService: '2025-09-20', nextService: '2025-12-20', status: 'Due', issue: 'Brake pads worn out', cost: 0 },
  { id: 'MN03', vehicleId: 'V01', vehicleNo: 'HR-26-AB-1245', type: 'Oil Change', lastService: '2025-10-15', nextService: '2026-01-15', status: 'Scheduled', cost: 0 },
  { id: 'MN04', vehicleId: 'V02', vehicleNo: 'HR-26-CD-2367', type: 'Tire Rotation', lastService: '2025-10-22', nextService: '2026-01-22', status: 'Scheduled', cost: 0 },
  { id: 'MN05', vehicleId: 'V04', vehicleNo: 'HR-26-GH-4512', type: 'General Check', lastService: '2025-10-08', nextService: '2026-01-08', status: 'Scheduled', cost: 0 },
]

interface TransportState {
  vehicles: Vehicle[]
  routes: Route[]
  drivers: Driver[]
  assignments: TransportAssignment[]
  maintenance: MaintenanceRecord[]
  search: string
  routeChange: RouteChangeNotice | null
  /** FINAL-GATE (EG-9F/R4) — set once the demo seed has been applied. */
  demoSeeded?: boolean
  /** FINAL-GATE (EG-9F/R4) — one-shot demo-tier seeder (module root). */
  ensureDemoSeed: () => void

  setSearch: (q: string) => void
  assignStudent: (studentId: string, routeId: string, stop: string) => { success: boolean; error?: string }
  removeAssignment: (assignmentId: string) => void
  changeRoute: (assignmentId: string, newRouteId: string) => void
  dismissRouteChange: () => void
  completeMaintenance: (maintenanceId: string) => void
}

export const useTransportStore = create<TransportState>()(
  persist(
    (set, get) => ({
  // FINAL-GATE (EG-9F/R4) — the seed corpus above is the sanctioned DEMO
  // TIER content (School.isDemo): the store boots EMPTY and the Transport
  // module root applies it once per session via `ensureDemoSeed`. A real
  // production tenant keeps the honest empty state; persisted tenant-
  // scoped state always wins over re-seeding.
  vehicles: [],
  routes: [],
  drivers: [],
  assignments: [],
  maintenance: [],
  search: '',
  routeChange: null,
  ensureDemoSeed: () => ensureTransportDemoSeed(),

  setSearch: (q) => set({ search: q }),

  assignStudent: (studentId, routeId, stop) => {
    const state = get()
    // Check if already assigned
    const existing = state.assignments.find((a) => a.studentId === studentId && a.status === 'Assigned')
    if (existing) return { success: false, error: 'Student already assigned to a route' }

    const student = useStudentsStore.getState().students.find((s) => s.id === studentId)
    if (!student) return { success: false, error: 'Student not found' }

    const route = state.routes.find((r) => r.id === routeId)
    if (!route) return { success: false, error: 'Route not found' }
    if (route.enrolled >= route.capacity) return { success: false, error: 'Route is full' }

    const assignment: TransportAssignment = {
      id: `TA${Date.now()}`,
      studentId,
      studentName: student.name,
      admissionNo: student.admissionNo,
      className: `${student.className}-${student.section}`,
      routeId,
      routeName: route.name,
      stop,
      vehicleNo: route.vehicleNo,
      driverName: route.driverName,
      status: 'Assigned',
    }

    set({
      assignments: [assignment, ...state.assignments],
      routes: state.routes.map((r) => r.id === routeId ? { ...r, enrolled: r.enrolled + 1 } : r),
    })
    return { success: true }
  },

  removeAssignment: (assignmentId) => {
    const state = get()
    const assignment = state.assignments.find((a) => a.id === assignmentId)
    if (!assignment) return
    set({
      assignments: state.assignments.filter((a) => a.id !== assignmentId),
      routes: state.routes.map((r) => r.id === assignment.routeId ? { ...r, enrolled: Math.max(0, r.enrolled - 1) } : r),
    })
  },

  changeRoute: (assignmentId, newRouteId) => {
    const state = get()
    const assignment = state.assignments.find((a) => a.id === assignmentId)
    const newRoute = state.routes.find((r) => r.id === newRouteId)
    if (!assignment || !newRoute) return
    if (newRoute.enrolled >= newRoute.capacity) return

    set({
      assignments: state.assignments.map((a) => a.id === assignmentId
        ? { ...a, routeId: newRouteId, routeName: newRoute.name, vehicleNo: newRoute.vehicleNo, driverName: newRoute.driverName }
        : a),
      routes: state.routes.map((r) => {
        if (r.id === assignment.routeId) return { ...r, enrolled: Math.max(0, r.enrolled - 1) }
        if (r.id === newRouteId) return { ...r, enrolled: r.enrolled + 1 }
        return r
      }),
      // T4-E — record the notice for the affected student (office truth,
      // shown in the student's Transport view until dismissed).
      routeChange: {
        studentId: assignment.studentId,
        newRouteName: newRoute.name,
        effectiveDate: new Date().toISOString().split('T')[0],
        stop: assignment.stop || undefined,
      },
    })
  },

  dismissRouteChange: () => set({ routeChange: null }),

  completeMaintenance: (maintenanceId) => {
    const state = get()
    const record = state.maintenance.find((m) => m.id === maintenanceId)
    if (!record) return
    const today = new Date().toISOString().split('T')[0]
    const next = new Date()
    next.setMonth(next.getMonth() + 3)
    set({
      maintenance: state.maintenance.map((m) => m.id === maintenanceId
        ? { ...m, status: 'Completed' as MaintenanceStatus, lastService: today, nextService: next.toISOString().split('T')[0], cost: Math.floor(Math.random() * 5000) + 2000 }
        : m),
      vehicles: state.vehicles.map((v) => v.id === record.vehicleId
        ? { ...v, status: 'Active' as VehicleStatus, lastService: today, nextService: next.toISOString().split('T')[0] }
        : v),
      routes: state.routes.map((r) => r.vehicleId === record.vehicleId && r.status === 'Maintenance'
        ? { ...r, status: 'At School' as RouteStatus }
        : r),
    })
  },
    }),
    {
      name: 'scholario-transport-v1',
      storage: createTenantScopedStorage('scholario-transport-v1'),
      // v1 → v2 (PIH-4c, stale-persist purge): the FINAL-GATE emptied the
      // initial seed state but the version was NOT bumped then — pre-gate
      // browsers would rehydrate the fabricated vehicle/route/driver
      // universe forever. The bump discards stale v1 persisted state once
      // (zustand skips hydration on version mismatch; the demo seeder
      // re-applies the corpus for the demo tenant).
      version: 2,
      // DATA slices only — search is UI state, actions are functions.
      // routeChange (T4-E) persists: a real notice survives reload until the
      // student dismisses it. Migration-safe: existing persisted blobs lack
      // the key, and zustand's shallow merge keeps the `routeChange: null`
      // initial value.
      partialize: (s) => ({
        vehicles: s.vehicles,
        routes: s.routes,
        drivers: s.drivers,
        assignments: s.assignments,
        maintenance: s.maintenance,
        routeChange: s.routeChange,
      }),
    },
  ),
)

// ─── FINAL-GATE (EG-9F/R4) demo-tier seeder ──────────────────────────
// Built lazily on first call (the store exists by then). Applies the
// sanctioned demo corpus at most once, never over non-pristine state —
// see makeDemoSeedApplier guard rules. Assignments are built at APPLY
// time (not module-load time) so they derive from whichever roster the
// demo session has (post-sync canonical roster when available).
let _ensureTransportDemoSeed: (() => void) | null = null
function ensureTransportDemoSeed(): void {
  _ensureTransportDemoSeed ??= makeDemoSeedApplier(useTransportStore, {
    vehicles: SEED_VEHICLES,
    routes: SEED_ROUTES,
    drivers: SEED_DRIVERS,
    assignments: buildAssignments(),
    maintenance: SEED_MAINTENANCE,
  })
  _ensureTransportDemoSeed()
}

export function useTransportData() {
  const vehicles = useTransportStore((s) => s.vehicles)
  const routes = useTransportStore((s) => s.routes)
  const drivers = useTransportStore((s) => s.drivers)
  const assignments = useTransportStore((s) => s.assignments)
  const maintenance = useTransportStore((s) => s.maintenance)

  return useMemo(() => {
    const totalVehicles = vehicles.length
    const totalRoutes = routes.length
    const totalDrivers = drivers.length
    const studentsUsingTransport = assignments.filter((a) => a.status === 'Assigned').length
    const onRoad = routes.filter((r) => r.status === 'On Route').length
    const inMaintenance = vehicles.filter((v) => v.status === 'Maintenance').length
    const gpsActive = vehicles.filter((v) => v.gps).length
    const maintenanceDue = maintenance.filter((m) => m.status === 'Due' || m.status === 'Overdue')
    const unassignedStudents = useStudentsStore.getState().students.filter((s) => s.status === 'Active' && s.transport && !assignments.some((a) => a.studentId === s.id)).length

    const routeDistribution = routes.map((r, i) => ({
      name: `R${i + 1}`,
      value: r.enrolled,
      color: ['oklch(0.55 0.14 162)', 'oklch(0.65 0.16 75)', 'oklch(0.7 0.15 200)', 'oklch(0.6 0.18 300)', 'oklch(0.62 0.2 25)', 'oklch(0.55 0.16 250)'][i % 6],
    }))

    const capacityUtil = routes.map((r, i) => ({
      name: `R${i + 1}`,
      value: Math.round((r.enrolled / r.capacity) * 100),
      enrolled: r.enrolled,
      capacity: r.capacity,
    }))

    return {
      vehicles, routes, drivers, assignments, maintenance,
      analytics: {
        totalVehicles, totalRoutes, totalDrivers,
        studentsUsingTransport, onRoad, inMaintenance, gpsActive,
        maintenanceDue, unassignedStudents,
        routeDistribution, capacityUtil,
      },
    }
  }, [vehicles, routes, drivers, assignments, maintenance])
}

/**
 * RB-1 — single-student transport-assignment resolver.
 *
 * A student "has transport" when EITHER the canonical roster marks the
 * opt-in (`StudentRecord.transport` — the same flag the seeded assignments
 * and the ₹500/month Transport fee head are gated on) OR an explicit
 * Assigned row exists in this store (the principal/office can assign from
 * the Transport module). This is the gate the student-side Transport nav
 * item derives from: students without an assignment never see Transport
 * anywhere in their workspace (sidebar or ⌘K search).
 */
export function useTransportAssignment(studentId: string): boolean {
  const optedIn = useStudentsStore(
    (s) => s.students.find((x) => x.id === studentId)?.transport ?? false,
  )
  const assignments = useTransportStore((s) => s.assignments)
  return useMemo(
    () =>
      optedIn ||
      assignments.some((a) => a.studentId === studentId && a.status === 'Assigned'),
    [optedIn, assignments, studentId],
  )
}
