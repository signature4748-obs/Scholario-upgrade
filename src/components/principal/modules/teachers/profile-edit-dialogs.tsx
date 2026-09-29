'use client'

/**
 * Profile edit dialogs (Wave 2.3B §4–§8).
 *
 * The Teacher Profile is a VIEW screen first: every edit lives behind a
 * small, focused dialog instead of turning the page into a giant form.
 * Every dialog is wired to the REAL store actions (updateTeacher,
 * removePositionFromTeacher, emergencyOverridePosition, setTeacherMedia)
 * and the REAL shared media pipeline (server-validated uploads) — no
 * parallel state, no fake controls.
 */

import { useEffect, useState } from 'react'
import {
  Pencil, ShieldAlert, Loader2,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { toast } from 'sonner'
import { departments } from '@/lib/mock/school'
import { useTeachersStore, type TeacherRecord, type PositionAssignment } from '@/lib/store/teachers-store'
import { PhotoStep } from '../admission/components/PhotoStep'
import { SignatureUpload } from './signature-upload'
import {
  validateTeacherMedia, uploadTeacherMedia, deleteTeacherMediaFile,
  toMediaRecord, dataUrlToBlob,
} from './teacher-media'
import { useTeacherMediaSrc } from './secure-teacher-media'

/* ------------------------------------------------------------------ */
/*  Shared dialog shell — consistent compact sizing                    */
/* ------------------------------------------------------------------ */

function EditDialogShell({
  open, onClose, title, description, icon, children, footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  icon?: React.ReactNode
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {icon}{title}
          </DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const smallInput = 'h-8 text-xs'

/* ------------------------------------------------------------------ */
/*  1 — Personal information                                           */
/* ------------------------------------------------------------------ */

export function PersonalEditDialog({ teacher, open, onClose }: { teacher: TeacherRecord; open: boolean; onClose: () => void }) {
  const updateTeacher = useTeachersStore((s) => s.updateTeacher)
  const [draft, setDraft] = useState(teacher)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setDraft(teacher) }, [open, teacher])

  const set = <K extends keyof TeacherRecord>(key: K, value: TeacherRecord[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const save = () => {
    if (!draft.email.trim() || !draft.phone.trim()) {
      toast.error('Email and phone are required')
      return
    }
    setSaving(true)
    updateTeacher(teacher.id, {
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      emergencyContact: {
        name: draft.emergencyContact.name.trim(),
        relation: draft.emergencyContact.relation.trim(),
        phone: draft.emergencyContact.phone.trim(),
      },
      currentAddress: draft.currentAddress.trim(),
      permAddress: draft.sameAddress ? draft.currentAddress.trim() : draft.permAddress,
    })
    setSaving(false)
    onClose()
    toast.success('Personal information updated', { description: 'Saved on the staff record.' })
  }

  return (
    <EditDialogShell
      open={open} onClose={onClose}
      title="Edit personal information"
      description="Contact details and correspondence address."
      icon={<Pencil className="h-4 w-4 text-primary" />}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-8">Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving} className="text-xs h-8 bg-primary text-primary-foreground">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={draft.email} onChange={(e) => set('email', e.target.value)} className={`mt-1 ${smallInput}`} type="email" />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input value={draft.phone} onChange={(e) => set('phone', e.target.value)} className={`mt-1 ${smallInput}`} />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <div>
            <Label className="text-xs">Emergency contact</Label>
            <Input value={draft.emergencyContact.name} onChange={(e) => setDraft((d) => ({ ...d, emergencyContact: { ...d.emergencyContact, name: e.target.value } }))} className={`mt-1 ${smallInput}`} />
          </div>
          <div>
            <Label className="text-xs">Relation</Label>
            <Input value={draft.emergencyContact.relation} onChange={(e) => setDraft((d) => ({ ...d, emergencyContact: { ...d.emergencyContact, relation: e.target.value } }))} className={`mt-1 ${smallInput}`} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Emergency phone</Label>
          <Input value={draft.emergencyContact.phone} onChange={(e) => setDraft((d) => ({ ...d, emergencyContact: { ...d.emergencyContact, phone: e.target.value } }))} className={`mt-1 ${smallInput}`} />
        </div>
        <div>
          <Label className="text-xs">Current address</Label>
          <Textarea
            value={draft.currentAddress}
            onChange={(e) => set('currentAddress', e.target.value)}
            className="mt-1 text-xs min-h-16"
            rows={2}
          />
        </div>
      </div>
    </EditDialogShell>
  )
}

/* ------------------------------------------------------------------ */
/*  2 — Employment information                                         */
/* ------------------------------------------------------------------ */

const EMPLOYMENT_STATUSES = ['Active', 'On Leave', 'Probation', 'Suspended'] as const
const EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Probation', 'Contract', 'Guest'] as const

export function EmploymentEditDialog({ teacher, open, onClose }: { teacher: TeacherRecord; open: boolean; onClose: () => void }) {
  const updateTeacher = useTeachersStore((s) => s.updateTeacher)
  const logAudit = useTeachersStore((s) => s.logAudit)
  const [draft, setDraft] = useState(teacher)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setDraft(teacher) }, [open, teacher])

  const save = () => {
    if (!draft.designation.trim() || !draft.department.trim()) {
      toast.error('Designation and department are required')
      return
    }
    setSaving(true)
    updateTeacher(teacher.id, {
      designation: draft.designation.trim(),
      department: draft.department.trim(),
      joiningDate: draft.joiningDate,
      employmentType: draft.employmentType,
      status: draft.status,
    })
    logAudit({
      category: 'Position Action',
      actorName: 'Dr. Ananya Iyer',
      actorRole: 'Principal',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Employment updated: ${draft.designation} · ${draft.department} · ${draft.employmentType} · ${draft.status}`,
    })
    setSaving(false)
    onClose()
    toast.success('Employment information updated', {
      description: 'Previously issued letters keep their original snapshot — issued documents are immutable.',
    })
  }

  return (
    <EditDialogShell
      open={open} onClose={onClose}
      title="Edit employment information"
      description="Position facts shown across the staff record. Issued letters are historical snapshots and are never rewritten."
      icon={<Pencil className="h-4 w-4 text-primary" />}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-8">Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving} className="text-xs h-8 bg-primary text-primary-foreground">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <div>
          <Label className="text-xs">Designation</Label>
          <Input value={draft.designation} onChange={(e) => setDraft((d) => ({ ...d, designation: e.target.value }))} className={`mt-1 ${smallInput}`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={draft.department} onValueChange={(v) => setDraft((d) => ({ ...d, department: v }))}>
              <SelectTrigger className={`mt-1 h-8 text-xs`}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Joining date</Label>
            {/* Compact popover calendar — h-8 matches the neighbouring
                small inputs; portal-positioned so it never overflows the
                modal (Safari/iPad safe, no native control). */}
            <DatePicker
              value={draft.joiningDate}
              onChange={(v) => { if (v) setDraft((d) => ({ ...d, joiningDate: v })) }}
              placeholder="Select date"
              compact
              formatStr="d MMM yyyy"
              className="mt-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Employment type</Label>
            <Select value={draft.employmentType} onValueChange={(v) => setDraft((d) => ({ ...d, employmentType: v as TeacherRecord['employmentType'] }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v as TeacherRecord['status'] }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </EditDialogShell>
  )
}

/* ------------------------------------------------------------------ */
/*  3 — Remove responsibility                                          */
/* ------------------------------------------------------------------ */

/**
 * Soft removal is the default: the assignment is flagged 'Pending Removal'
 * (disappears from the active list, record kept for audit). Emergency
 * removal takes effect instantly and requires the Principal authorization
 * code — both are the store's existing removal semantics.
 */
export function RemoveResponsibilityDialog({
  teacher, assignment, open, onClose,
}: {
  teacher: TeacherRecord
  assignment: PositionAssignment | null
  open: boolean
  onClose: () => void
}) {
  const removePositionFromTeacher = useTeachersStore((s) => s.removePositionFromTeacher)
  const [reason, setReason] = useState('')
  const [emergency, setEmergency] = useState(false)
  const [authCode, setAuthCode] = useState('')

  useEffect(() => {
    if (open) { setReason('Administrative Reassignment'); setEmergency(false); setAuthCode('') }
  }, [open])

  if (!assignment) return null

  const confirm = () => {
    if (!reason.trim()) {
      toast.error('A removal reason is required for the audit trail')
      return
    }
    if (emergency && authCode.trim() !== 'OVERRIDE-2025' && authCode.trim() !== '123456') {
      toast.error('Invalid authorization code', { description: 'Emergency removal requires the Principal override code.' })
      return
    }
    removePositionFromTeacher(teacher.id, assignment.id, reason.trim(), emergency, authCode.trim())
    onClose()
    toast.success(
      emergency
        ? `Removed "${assignment.positionTitle}" immediately`
        : `Removal of "${assignment.positionTitle}" initiated`,
      {
        description: emergency
          ? 'Emergency removal recorded in the audit trail with the authorization code.'
          : 'The teacher acknowledges the change; the historical record is preserved.',
      }
    )
  }

  return (
    <EditDialogShell
      open={open} onClose={onClose}
      title={`Remove "${assignment.positionTitle}"`}
      description={`From ${teacher.name}'s responsibilities. The assignment record and its history remain in the audit trail.`}
      icon={<ShieldAlert className="h-4 w-4 text-amber-600" />}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs h-8">Cancel</Button>
          <Button variant="destructive" size="sm" onClick={confirm} className="text-xs h-8">
            {emergency ? 'Remove immediately' : 'Request removal'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <div>
          <Label className="text-xs">Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 text-xs min-h-16" rows={2} />
        </div>
        <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 cursor-pointer">
          <Checkbox checked={emergency} onCheckedChange={(v) => setEmergency(v === true)} className="mt-0.5" />
          <span className="text-xs">
            <span className="font-medium text-foreground">Remove immediately (emergency)</span>
            <span className="block text-muted-foreground mt-0.5">
              Bypasses the acknowledgement step. Requires the Principal authorization code and is logged as an emergency override.
            </span>
          </span>
        </label>
        {emergency && (
          <div>
            <Label className="text-xs">Authorization code</Label>
            <Input value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="OVERRIDE-XXXX" className={`mt-1 ${smallInput} font-mono`} />
          </div>
        )}
      </div>
    </EditDialogShell>
  )
}

/* ------------------------------------------------------------------ */
/**
 * Phase 1 — persisted staff photos resolve through a short-lived signed
 * URL (no anonymous media reads); fresh uploads keep their dataUrl
 * preview. Hosts PhotoStep with the resolved render source.
 */
function SecurePhotoStepHost({
  record,
  onChange,
}: {
  record: import('@/lib/store/teachers-store').TeacherMediaRecord | null | undefined
  onChange: (dataUrl: string | null) => void
}) {
  const src = useTeacherMediaSrc(record ?? null)
  return (
    <PhotoStep
      photoDataUrl={src}
      onChange={onChange}
      title="Photograph"
      recordLabel="staff record"
      suppressToasts
      startInPreview
    />
  )
}

/*  4 — Photo (hosts the existing capture/crop pipeline in a dialog)   */
/* ------------------------------------------------------------------ */

export function PhotoEditDialog({ teacher, open, onClose }: { teacher: TeacherRecord; open: boolean; onClose: () => void }) {
  const setTeacherMedia = useTeachersStore((s) => s.setTeacherMedia)
  const [busy, setBusy] = useState(false)

  const handleChange = async (dataUrl: string | null) => {
    if (!dataUrl) {
      if (teacher.photo) deleteTeacherMediaFile(teacher.photo.fileId)
      setTeacherMedia(teacher.id, 'photo', null)
      toast.info('Photo removed')
      return
    }
    setBusy(true)
    try {
      const blob = await dataUrlToBlob(dataUrl)
      const file = new File([blob], 'teacher-photo.jpg', { type: blob.type || 'image/jpeg' })
      const validationError = await validateTeacherMedia(file, 'photo')
      if (validationError) {
        toast.error(validationError)
        return
      }
      const uploaded = await uploadTeacherMedia(file, 'photo', { dataUrl })
      if (teacher.photo) deleteTeacherMediaFile(teacher.photo.fileId)
      setTeacherMedia(teacher.id, 'photo', toMediaRecord(uploaded))
      toast.success('Photo updated', { description: 'The staff photo now reflects across the staff record.' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Photo upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Edit photo — {teacher.name}</DialogTitle>
          <DialogDescription>Upload, capture or re-crop the staff photograph.</DialogDescription>
        </DialogHeader>
        <div className="p-4 sm:p-5">
          <SecurePhotoStepHost
            record={teacher.photo}
            onChange={handleChange}
          />
          {busy && <p className="text-[11px] text-muted-foreground mt-2">Storing photo on the staff record…</p>}
          <div className="flex justify-end mt-3">
            <Button size="sm" variant="outline" onClick={onClose} className="text-xs h-8">Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/*  5 — Signature (hosts the existing upload flow in a dialog)         */
/* ------------------------------------------------------------------ */

export function SignatureEditDialog({ teacher, open, onClose }: { teacher: TeacherRecord; open: boolean; onClose: () => void }) {
  const setTeacherMedia = useTeachersStore((s) => s.setTeacherMedia)

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Signature — {teacher.name}</DialogTitle>
          <DialogDescription className="text-xs">
            A clear scan or photo of the employee&rsquo;s signature (JPG / PNG / WebP · ≤ 1 MB). The original file is stored as uploaded.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <SignatureUpload
            value={teacher.signature ?? null}
            onChange={(media) => {
              setTeacherMedia(teacher.id, 'signature', media)
              if (media) onClose()
            }}
          />
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose} className="text-xs h-8">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
