'use client'

/**
 * transport-users — Transport Users panel + Assign Student dialog +
 * Change Route dialog.
 *
 * Reads assignments from the transport store. The students come from the
 * canonical `useStudentsStore` — NO duplicate student data lives in the
 * transport store.
 *
 * Columns on the assignments table:
 *   - Student (name + admissionNo + class)
 *   - Route (routeName)
 *   - Stop
 *   - Vehicle (vehicleNo)
 *   - Driver (driverName)
 *   - Actions (Change Route · Remove)
 *
 * Mutations wired:
 *   - assignStudent(studentId, routeId, stop)  — Assign Student dialog
 *   - changeRoute(assignmentId, newRouteId)    — Change Route dialog
 *   - removeAssignment(assignmentId)           — Remove confirm dialog (in index)
 */

import { useMemo, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Users, Search, UserPlus, Route as RouteIcon, Bus, MapPin, ArrowRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { useTransportStore } from '@/lib/store/transport-store'
import type { TransportAssignment } from '@/lib/store/transport-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { GradientAvatar } from '@/components/shared/ui'
import { SearchableSelect } from '@/components/principal/modules/shared/searchable-select'
import { initials } from '@/lib/format'
import { toast } from 'sonner'
import {
  TptPanel,
  TptEmptyState,
  TptPill,
} from './transport-shared'

// ─── AssignmentsTable ───────────────────────────────────────────────

interface AssignmentsTableProps {
  search?: string
  onAssign: () => void
  onChangeRoute: (assignment: TransportAssignment) => void
  onRemove: (assignment: TransportAssignment) => void
}

export function AssignmentsTable({
  search: externalSearch,
  onAssign,
  onChangeRoute,
  onRemove,
}: AssignmentsTableProps) {
  const assignments = useTransportStore((s) => s.assignments)
  const internalSearch = useTransportStore((s) => s.search)
  const setSearch = useTransportStore((s) => s.setSearch)

  const q = (externalSearch ?? internalSearch).trim().toLowerCase()

  const filtered = assignments.filter((a) => {
    if (!q) return true
    return (
      a.studentName.toLowerCase().includes(q) ||
      a.admissionNo.toLowerCase().includes(q) ||
      a.className.toLowerCase().includes(q) ||
      a.routeName.toLowerCase().includes(q) ||
      a.stop.toLowerCase().includes(q)
    )
  })

  return (
    <TptPanel
      title="Transport Users"
      subtitle={`${filtered.length} of ${assignments.length} students assigned`}
      action={
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={externalSearch ?? internalSearch}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, class, route, stop"
              className="pl-8 h-8 w-40 sm:w-56 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
            onClick={onAssign}
          >
            <UserPlus className="h-3.5 w-3.5" /> Assign Student
          </Button>
        </div>
      }
      bodyClassName="p-0"
    >
      {filtered.length === 0 ? (
        <TptEmptyState
          icon={<Users className="h-5 w-5" />}
          title="No transport users found"
          description="Assign students to routes from the canonical student list."
          action={
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
              onClick={onAssign}
            >
              <UserPlus className="h-3.5 w-3.5" /> Assign Student
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Student</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Route</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden sm:table-cell">Stop</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Vehicle</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden lg:table-cell">Driver</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a, i) => (
                <motion.tr
                  key={a.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="hover:bg-accent/30 transition-colors"
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <GradientAvatar name={a.studentName} size="sm" />
                      <div className="min-w-0 max-w-[240px]">
                        <p className="font-medium text-sm truncate">{a.studentName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          <span className="font-mono">{a.admissionNo}</span>
                          <span className="text-muted-foreground/40"> · </span>
                          {a.className}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <RouteIcon className="h-3 w-3 text-emerald-600" />
                      <span className="truncate max-w-[200px]" title={a.routeName}>
                        {a.routeName}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {a.stop}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                      <Bus className="h-3 w-3 text-muted-foreground" /> {a.vehicleNo}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                    {a.driverName}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-[10px] h-7"
                        onClick={() => onChangeRoute(a)}
                      >
                        <ArrowRight className="h-3 w-3" /> Change Route
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-[10px] h-7 border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
                        onClick={() => onRemove(a)}
                      >
                        <X className="h-3 w-3" /> Remove
                      </Button>
                    </div>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </TptPanel>
  )
}

// ─── AssignStudentDialog ────────────────────────────────────────────

interface AssignStudentDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
}

export function AssignStudentDialog({ open, onOpenChange }: AssignStudentDialogProps) {
  const routes = useTransportStore((s) => s.routes)
  const assignments = useTransportStore((s) => s.assignments)
  const assignStudent = useTransportStore((s) => s.assignStudent)
  const students = useStudentsStore((s) => s.students)

  const [studentId, setStudentId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [stop, setStop] = useState('')

  // Reset state when dialog opens.
  useEffect(() => {
    if (open) {
      setStudentId('')
      setRouteId('')
      setStop('')
    }
  }, [open])

  // Eligible students: Active + transport=true + NOT already assigned to a route.
  // (The store allows assigning a student only if not already in an active assignment.)
  const studentOptions = useMemo(() => {
    const assignedIds = new Set(
      assignments.filter((a) => a.status === 'Assigned').map((a) => a.studentId)
    )
    return students
      .filter((s) => s.status === 'Active' && s.transport && !assignedIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.name,
        avatar: initials(s.name),
        meta: `${s.admissionNo} · ${s.className}-${s.section}`,
      }))
  }, [students, assignments])

  // Eligible routes: not Inactive, not Maintenance, with seats available.
  const routeOptions = useMemo(() => {
    return routes
      .filter((r) => r.status !== 'Inactive' && r.status !== 'Maintenance' && r.enrolled < r.capacity)
      .map((r) => ({
        id: r.id,
        label: r.name,
        avatar: `${r.enrolled}/${r.capacity}`,
        meta: `${r.vehicleNo} · ${r.driverName} · ${r.enrolled}/${r.capacity} seats`,
      }))
  }, [routes])

  const selectedRoute = routes.find((r) => r.id === routeId)
  const selectedStudent = students.find((s) => s.id === studentId)

  const canAssign =
    !!studentId && !!routeId && !!stop.trim() && !!selectedRoute && !!selectedStudent

  const handleSubmit = () => {
    if (!canAssign) {
      if (!studentId) toast.error('Please select a student')
      else if (!routeId) toast.error('Please select a route')
      else if (!stop.trim()) toast.error('Please enter a stop')
      return
    }
    const result = assignStudent(studentId, routeId, stop.trim())
    if (!result.success) {
      toast.error(result.error || 'Failed to assign student')
      return
    }
    toast.success('Student assigned', {
      description: `${selectedStudent!.name} → ${selectedRoute!.name} (Stop: ${stop.trim()})`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Assign Student to Route
          </DialogTitle>
          <DialogDescription>
            Select a transport-eligible student, a route with available seats, and a stop.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Student */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Student
            </Label>
            <SearchableSelect
              selectedId={studentId}
              onSelect={setStudentId}
              placeholder="Search transport-eligible student"
              options={studentOptions}
              pickerId="tpt-student"
            />
            {selectedStudent && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <TptPill accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Transport eligible
                </TptPill>
                <span className="text-[10px] text-muted-foreground">
                  {selectedStudent.admissionNo} · {selectedStudent.className}-{selectedStudent.section}
                </span>
              </div>
            )}
            {studentOptions.length === 0 && (
              <p className="text-[10px] text-amber-600 mt-1">
                No transport-eligible students available for assignment. All eligible students are already assigned.
              </p>
            )}
          </div>

          {/* Route */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <RouteIcon className="h-3 w-3" /> Route
            </Label>
            <SearchableSelect
              selectedId={routeId}
              onSelect={setRouteId}
              placeholder="Search route with available seats"
              options={routeOptions}
              pickerId="tpt-route"
            />
            {selectedRoute && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <TptPill accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  {selectedRoute.enrolled}/{selectedRoute.capacity} seats
                </TptPill>
                <span className="text-[10px] text-muted-foreground">
                  {selectedRoute.vehicleNo} · {selectedRoute.driverName}
                </span>
              </div>
            )}
          </div>

          {/* Stop */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <MapPin className="h-3 w-3" /> Boarding Stop
            </Label>
            <Input
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              placeholder="e.g. DLF Phase 3 · Sector 14 Main Road · Bus Stop 4"
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Enter the pickup point nearest to the student's residence.
            </p>
          </div>

          {/* Policy notice */}
          <div className="rounded-md bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] border border-emerald-500/20 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">Note:</span>{' '}
            Students can only be assigned to one active route at a time.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canAssign}
            className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
          >
            <UserPlus className="h-3.5 w-3.5" /> Assign Student
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ChangeRouteDialog ──────────────────────────────────────────────

interface ChangeRouteDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  assignment: TransportAssignment | null
}

export function ChangeRouteDialog({ open, onOpenChange, assignment }: ChangeRouteDialogProps) {
  const routes = useTransportStore((s) => s.routes)
  const changeRoute = useTransportStore((s) => s.changeRoute)

  const [newRouteId, setNewRouteId] = useState('')

  useEffect(() => {
    if (open) setNewRouteId('')
  }, [open])

  const currentRoute = routes.find((r) => r.id === assignment?.routeId)

  // Eligible new routes: not the current route, not Maintenance/Inactive, with seats.
  const routeOptions = useMemo(() => {
    if (!assignment) return []
    return routes
      .filter(
        (r) =>
          r.id !== assignment.routeId &&
          r.status !== 'Inactive' &&
          r.status !== 'Maintenance' &&
          r.enrolled < r.capacity
      )
      .map((r) => ({
        id: r.id,
        label: r.name,
        avatar: `${r.enrolled}/${r.capacity}`,
        meta: `${r.vehicleNo} · ${r.driverName} · ${r.enrolled}/${r.capacity} seats`,
      }))
  }, [routes, assignment])

  const selectedRoute = routes.find((r) => r.id === newRouteId)
  const canChange = !!newRouteId && !!assignment && !!selectedRoute

  const handleSubmit = () => {
    if (!canChange || !assignment) {
      if (!newRouteId) toast.error('Please select a new route')
      return
    }
    changeRoute(assignment.id, newRouteId)
    toast.success('Route changed', {
      description: `${assignment.studentName} moved from ${currentRoute?.name ?? 'previous route'} to ${selectedRoute!.name}`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" />
            Change Route
          </DialogTitle>
          <DialogDescription>
            Move the student to a different route. The previous route frees one seat; the new route reserves one.
          </DialogDescription>
        </DialogHeader>

        {assignment && (
          <div className="space-y-4">
            {/* Student context */}
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <GradientAvatar name={assignment.studentName} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{assignment.studentName}</p>
                <p className="text-[10px] text-muted-foreground">
                  <span className="font-mono">{assignment.admissionNo}</span> · {assignment.className}
                </p>
              </div>
            </div>

            {/* Current → New route visual */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                <p className="text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">Current</p>
                <p className="text-xs font-semibold mt-0.5 truncate" title={currentRoute?.name}>
                  {currentRoute?.name ?? '—'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {currentRoute?.vehicleNo ?? '—'}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] px-2.5 py-2">
                <p className="text-[9px] uppercase font-semibold text-emerald-700 dark:text-emerald-300 tracking-wider">New</p>
                <p className="text-xs font-semibold mt-0.5 truncate" title={selectedRoute?.name}>
                  {selectedRoute?.name ?? '— select —'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {selectedRoute?.vehicleNo ?? '—'}
                </p>
              </div>
            </div>

            {/* New route select */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <RouteIcon className="h-3 w-3" /> New Route
              </Label>
              <SearchableSelect
                selectedId={newRouteId}
                onSelect={setNewRouteId}
                placeholder="Search route with available seats"
                options={routeOptions}
                pickerId="tpt-change-route"
              />
              {routeOptions.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">
                  No other routes have available seats right now.
                </p>
              )}
            </div>

            {/* Stop info — unchanged */}
            <div className="rounded-md bg-muted/20 border border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Stop:</span> {assignment.stop}
              <span className="ml-1">(unchanged)</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canChange}
            className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
          >
            <ArrowRight className="h-3.5 w-3.5" /> Change Route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── RemoveAssignmentConfirm ────────────────────────────────────────

interface RemoveAssignmentConfirmProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  assignment: TransportAssignment | null
}

export function RemoveAssignmentConfirm({
  open,
  onOpenChange,
  assignment,
}: RemoveAssignmentConfirmProps) {
  const removeAssignment = useTransportStore((s) => s.removeAssignment)

  const handleConfirm = () => {
    if (!assignment) return
    removeAssignment(assignment.id)
    toast.success('Assignment removed', {
      description: `${assignment.studentName} is no longer assigned to ${assignment.routeName}.`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <X className="h-4 w-4" />
            Remove Transport Assignment
          </DialogTitle>
          <DialogDescription className="text-xs">
            {assignment
              ? `${assignment.studentName} (${assignment.admissionNo}) will be removed from "${assignment.routeName}". The route will free one seat.`
              : 'Remove the transport assignment.'}
          </DialogDescription>
        </DialogHeader>
        {assignment && (
          <div className="flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.04] dark:bg-rose-500/[0.06] px-3 py-2.5">
            <GradientAvatar name={assignment.studentName} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{assignment.studentName}</p>
              <p className="text-[10px] text-muted-foreground">
                <span className="font-mono">{assignment.admissionNo}</span> · {assignment.className}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!assignment}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Remove Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── UnassignedStudentsBanner ───────────────────────────────────────
// Shows the count of transport-eligible students who are not yet assigned.

export function UnassignedStudentsBanner({
  onAssign,
  unassignedCount,
}: {
  onAssign: () => void
  unassignedCount: number
}) {
  if (unassignedCount === 0) return null
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.04] dark:bg-amber-500/[0.06] border border-amber-500/20">
      <Users className="h-4 w-4 text-amber-600 shrink-0" />
      <p className="text-xs text-muted-foreground flex-1">
        <span className="font-semibold text-amber-700 dark:text-amber-300">{unassignedCount}</span> transport-eligible
        student{unassignedCount === 1 ? '' : 's'} not yet assigned to a route.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
        onClick={onAssign}
      >
        <UserPlus className="h-3 w-3" /> Assign
      </Button>
    </div>
  )
}
