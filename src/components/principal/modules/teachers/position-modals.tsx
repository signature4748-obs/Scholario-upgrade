'use client'

/**
 * Responsibility management modals (Wave 2.3C §6–§9, §16–§18).
 *
 * Assign Responsibility — opened from a specific teacher's profile, so the
 * teacher is the CONTEXT (header subtitle), never a form field. Just:
 * Responsibility · Effective from · optional Assigned-by source. The
 * acceptance workflow is real end-to-end (the teacher sees a Pending
 * Acceptance request and can accept or decline) — the row's status
 * communicates it, no explanatory paragraph needed.
 *
 * (7-B) The former "Emergency Override" affordance — an instant activation
 * gated by a hardcoded client-side authorization code — was a fake
 * authorization surface with no server-side mutation behind it, and has
 * been removed entirely. Responsibilities follow the acceptance workflow.
 *
 * Create Custom Responsibility — a small focused form; the definition
 * becomes part of the canonical school positions list (permissions stay
 * derived from the responsibility definition — never edited ad hoc).
 */

import { useEffect, useState } from 'react'
import {
  Shield, Plus,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type {
  TeacherRecord,
  PositionDefinition,
} from '@/lib/store/teachers-store'
import { allPermissions } from './add-teacher-data'

interface CommonProps {
  open: boolean
  onClose: () => void
}

const today = () => new Date().toISOString().split('T')[0]

/* ---------- ASSIGN RESPONSIBILITY MODAL ---------- */
interface AssignPositionModalProps extends CommonProps {
  /** The teacher whose profile opened this modal — the assignment target. */
  teacher: TeacherRecord | null
  positionsList: PositionDefinition[]
  selectedPosIdToAssign: string
  setSelectedPosIdToAssign: (v: string) => void
  onConfirm: (payload: { effectiveDate: string; assignedBy: string }) => void
  /** Opens the Create Custom Responsibility dialog. */
  onCreateCustomPosition?: () => void
}

export function AssignPositionModal({
  teacher, positionsList,
  selectedPosIdToAssign, setSelectedPosIdToAssign,
  open, onClose, onConfirm,
  onCreateCustomPosition,
}: AssignPositionModalProps) {
  const [effectiveDate, setEffectiveDate] = useState(today())
  const [assignedBy, setAssignedBy] = useState('')

  useEffect(() => {
    if (open) {
      setEffectiveDate(today())
      setAssignedBy('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Shield className="h-4 w-4 text-primary" /> Assign Responsibility
          </DialogTitle>
          {teacher && (
            <DialogDescription className="text-xs">
              {teacher.name} · {teacher.designation}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          <div>
            <Label className="text-xs">Responsibility</Label>
            <Select value={selectedPosIdToAssign} onValueChange={setSelectedPosIdToAssign}>
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="Choose responsibility" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {positionsList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title} <span className="text-muted-foreground">· {p.category}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {onCreateCustomPosition && (
              <button
                type="button"
                onClick={onCreateCustomPosition}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <Plus className="h-3 w-3" /> Create custom responsibility
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Effective from</Label>
              {/* Compact popover calendar — same visual height as the
                  neighbouring inputs; portal-positioned so it never
                  overflows the modal (Safari/iPad safe, no native control). */}
              <DatePicker
                value={effectiveDate}
                onChange={(v) => { if (v) setEffectiveDate(v) }}
                placeholder="Select date"
                compact
                formatStr="d MMM yyyy"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">
                Assigned by <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                value={assignedBy}
                onChange={(e) => setAssignedBy(e.target.value)}
                placeholder="e.g. Board of Governors"
                className="mt-1 h-9 text-xs"
              />
            </div>
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="text-xs h-9">Cancel</Button>
          <Button
            onClick={() => onConfirm({ effectiveDate, assignedBy: assignedBy.trim() })}
            className="text-xs h-9 bg-primary text-primary-foreground"
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- CREATE CUSTOM RESPONSIBILITY MODAL ---------- */
interface CreateCustomPositionModalProps extends CommonProps {
  onCreate: (pos: Omit<PositionDefinition, 'id'>) => void
}

export function CreateCustomPositionModal({ open, onClose, onCreate }: CreateCustomPositionModalProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<'Academic' | 'Administrative' | 'Co-Curricular' | 'Management' | 'Custom'>('Custom')
  const [description, setDescription] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    'view_assigned_classes', 'enter_subject_marks', 'take_class_attendance',
  ])

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setSelectedPermissions([
        'view_assigned_classes', 'enter_subject_marks', 'take_class_attendance',
      ])
    }
  }, [open])

  const handleToggle = (key: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  const handleSave = () => {
    if (!title.trim()) {
      toast.error('Please enter a name for the responsibility')
      return
    }
    onCreate({
      title,
      category,
      description,
      permissions: selectedPermissions,
      isCustom: true,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Shield className="h-4 w-4 text-primary" /> Create Custom Responsibility
          </DialogTitle>
          <DialogDescription className="text-xs">
            Added to the school&rsquo;s responsibility list — assignable to any teacher.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          <div className="grid grid-cols-[1fr_150px] gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Science Fair Convener"
                className="mt-1 h-9 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Academic">Academic</SelectItem>
                  <SelectItem value="Administrative">Administrative</SelectItem>
                  <SelectItem value="Co-Curricular">Co-Curricular</SelectItem>
                  <SelectItem value="Management">Management</SelectItem>
                  <SelectItem value="Custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope of the responsibility"
              className="mt-1 h-9 text-xs"
            />
          </div>

          <div>
            <Label className="text-xs mb-2 block">Permissions granted by this responsibility</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto p-0.5">
              {allPermissions.map((p) => {
                const checked = selectedPermissions.includes(p.key)
                return (
                  <label
                    key={p.key}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs cursor-pointer transition-colors',
                      checked ? 'border-primary/40 bg-primary/5 text-foreground font-medium' : 'border-border bg-card/40 text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => handleToggle(p.key)} className="h-3.5 w-3.5" />
                    <span className="truncate">{p.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="text-xs h-9">Cancel</Button>
          <Button onClick={handleSave} className="text-xs h-9 bg-primary text-primary-foreground">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
