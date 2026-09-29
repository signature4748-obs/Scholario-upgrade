'use client'

/**
 * TourConfigScreen — the SESSION SETUP screen for the built-in
 * "Educational Tour — Parent Consent Form" (TOUR-1 §2).
 *
 * Replaces the retired form builder: the template's layout is FIXED and
 * cannot be redesigned. The Principal (or an authorized Teacher, whose
 * draft then passes through the existing Principal approval workflow)
 * edits ONLY the information that genuinely changes per session/tour:
 *
 *   tour title · destination · tour dates · duration · tour fee · payment
 *   availability · circular/ref no · circular date · tour in-charge ·
 *   accompanying staff · short instructions · eligible classes · gender
 *   eligibility · last date to apply
 *
 * The pipeline is explicit and simple: DRAFT → PREVIEW → PUBLISH.
 * A live, properly-scaled A4 preview of the official printed form renders
 * beside the configuration on desktop (and behind a Preview toggle on
 * smaller screens). No developer language, no form-design vocabulary.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, CalendarDays, CheckCircle2, FileText, IndianRupee, Info, Printer,
  Save, Send, Eye, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { DatePicker } from '@/components/ui/date-picker'
import {
  useApplicationsStore, TOUR_FORM_FIELDS, APPLICATION_TEMPLATES,
  TOUR_DOC_TEMPLATES, TOUR_DOC_TEMPLATE_ORDER, effectiveAppStatus, isApplicationEditable,
  type TourDocTemplate, type SchoolApplication, type CreateApplicationInput,
} from '@/lib/store/applications-store'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { ACADEMIC_CLASSES } from '@/lib/mock/academic/classes'
import { CURRENT_ACADEMIC_YEAR } from '@/lib/store/fee-store-data'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { TourFormDocument, useFitA4Zoom, printTourDocument } from './tour-form-document'
import { downloadTourFormPDF } from './tour-form-pdf'
import { DocTemplateThumb } from './new-application-dialog'


type FieldGroup = 'basics' | 'schedule' | 'circular' | 'eligibility' | 'fee'

interface ConfigDraft {
  title: string
  destination: string
  eventDate: string
  tourEndDate: string
  durationDays: string
  deadline: string
  circularNo: string
  circularDate: string
  inChargeTeacherId: string
  inChargeName: string
  accompanyingStaff: string
  tourInstructions: string
  targetClassIds: string[]
  genderEligibility: 'All' | 'Boys' | 'Girls'
  paymentAmount: number
  paymentAvailability: 'Both' | 'Online' | 'Cash'
  /** AF-TPL — which of the two official A4 document layouts this session prints on. */
  docTemplate: TourDocTemplate
}

function draftOf(app?: SchoolApplication, initialTemplate?: TourDocTemplate): ConfigDraft {
  const t = APPLICATION_TEMPLATES.educational_tour
  if (!app) {
    return {
      title: '',
      destination: '',
      eventDate: '',
      tourEndDate: '',
      durationDays: '',
      deadline: '',
      circularNo: '',
      circularDate: '',
      inChargeTeacherId: '',
      inChargeName: '',
      accompanyingStaff: '',
      tourInstructions: '',
      targetClassIds: [],
      genderEligibility: 'All',
      paymentAmount: t.defaultAmount,
      paymentAvailability: 'Both',
      docTemplate: initialTemplate ?? 'classic',
    }
  }
  return {
    title: app.title,
    destination: app.destination ?? '',
    eventDate: app.eventDate ?? '',
    tourEndDate: app.tourEndDate ?? '',
    durationDays: app.durationDays ?? '',
    deadline: app.deadline,
    circularNo: app.circularNo ?? '',
    circularDate: app.circularDate ?? '',
    inChargeTeacherId: app.inChargeTeacherId ?? '',
    inChargeName: app.inChargeName ?? '',
    accompanyingStaff: app.accompanyingStaff ?? '',
    tourInstructions: app.tourInstructions ?? '',
    targetClassIds: [...app.targetClassIds],
    genderEligibility: app.genderEligibility ?? 'All',
    paymentAmount: app.payment.mode === 'None' ? 0 : app.payment.amount,
    paymentAvailability: app.paymentAvailability ?? 'Both',
    docTemplate: app.docTemplate ?? 'classic',
  }
}

interface Props {
  /** Existing tour instance to reconfigure (undefined = a fresh session). */
  editing?: SchoolApplication
  /** Chosen A4 document template for a FRESH session (from the selection dialog). */
  initialTemplate?: TourDocTemplate
  actorRole: 'Principal' | 'Teacher'
  teacherId?: string
  actorName: string
  onBack: () => void
  /** Called after the draft is saved (new instance created). */
  onSaved: (appId: string) => void
  /** Called after a successful publish. */
  onPublished: (appId: string) => void
}

export function TourConfigScreen({ editing, initialTemplate, actorRole, teacherId, actorName, onBack, onSaved, onPublished }: Props) {
  const createApplication = useApplicationsStore((s) => s.createApplication)
  const updateApplication = useApplicationsStore((s) => s.updateApplication)
  const publishApplication = useApplicationsStore((s) => s.publishApplication)
  const submitForApproval = useApplicationsStore((s) => s.submitForApproval)
  const teachers = useTeachersStore((s) => s.teachers)

  const [draft, setDraft] = useState<ConfigDraft>(() => draftOf(editing, initialTemplate))
  const [saving, setSaving] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [templatePickOpen, setTemplatePickOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'form' | 'preview'>('form')

  const teacherOptions = useMemo(
    () => teachers.filter((t) => t.status === 'Active' || t.status === 'On Leave').map((t) => ({ id: t.id, name: t.name })),
    [teachers],
  )
  const inChargeLocked = actorRole === 'Teacher' && !!teacherId

  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const toggleClass = (classId: string) =>
    setDraft((d) => ({
      ...d,
      targetClassIds: d.targetClassIds.includes(classId)
        ? d.targetClassIds.filter((c) => c !== classId)
        : [...d.targetClassIds, classId],
    }))

  // Validation — plain-English, school-administrator language.
  const problems = useMemo(() => {
    const p: string[] = []
    if (!draft.title.trim()) p.push('Give the tour a title (e.g. "Educational Tour — Jaipur").')
    if (!draft.destination.trim()) p.push('Enter the destination.')
    if (!draft.eventDate) p.push('Pick the tour start date.')
    if (!draft.deadline) p.push('Pick the last date to apply.')
    if (draft.eventDate && draft.deadline && draft.deadline >= draft.eventDate) {
      // allowed, but a warning not an error — keep silent here
    }
    if (draft.tourEndDate && draft.eventDate && draft.tourEndDate < draft.eventDate) {
      p.push('The tour end date cannot be before the start date.')
    }
    if (draft.targetClassIds.length === 0) p.push('Select at least one eligible class.')
    if (draft.paymentAmount > 0 && draft.paymentAmount < 1) p.push('Enter a valid tour fee.')
    if (!draft.inChargeTeacherId && !inChargeLocked) p.push('Choose the teacher / tour in-charge.')
    return p
  }, [draft, inChargeLocked])

  // Live preview model — the official document as configured so far.
  const previewApp: SchoolApplication = useMemo(() => ({
    id: editing?.id ?? 'PREVIEW',
    title: draft.title.trim() || 'Educational Tour',
    destination: draft.destination.trim() || undefined,
    description: undefined,
    category: 'Tour',
    templateKey: 'educational_tour',
    source: 'Event',
    academicYear: editing?.academicYear ?? CURRENT_ACADEMIC_YEAR,
    tourEndDate: draft.tourEndDate || undefined,
    durationDays: draft.durationDays.trim() || undefined,
    circularNo: draft.circularNo.trim() || undefined,
    circularDate: draft.circularDate || undefined,
    accompanyingStaff: draft.accompanyingStaff.trim() || undefined,
    tourInstructions: draft.tourInstructions.trim() || undefined,
    genderEligibility: draft.genderEligibility,
    paymentAvailability: draft.paymentAvailability,
    docTemplate: draft.docTemplate,
    targetClassIds: draft.targetClassIds,
    deadline: draft.deadline || '—',
    eventDate: draft.eventDate || undefined,
    participation: 'Optional',
    guardianConsent: { required: true, method: 'Digital' as const, statement: APPLICATION_TEMPLATES.educational_tour.consentStatement },
    teacherApprovalRequired: false,
    physicalSignatureRequired: false,
    inChargeTeacherId: inChargeLocked ? teacherId : draft.inChargeTeacherId || undefined,
    inChargeName: inChargeLocked ? actorName : (draft.inChargeName || undefined),
    payment: {
      mode: draft.paymentAmount > 0 ? 'Required' as const : 'None' as const,
      amount: draft.paymentAmount,
      feeHeadLabel: draft.title.trim() || 'Educational Tour',
      chargeId: editing?.payment.chargeId,
    },
    formFields: TOUR_FORM_FIELDS.map((f) => ({ ...f })),
    status: 'Draft',
    createdBy: actorName,
    createdByRole: actorRole,
    approvalNotes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [draft, editing, actorRole, actorName, inChargeLocked, teacherId])

  const buildInput = (): CreateApplicationInput => ({
    title: draft.title.trim() || 'Educational Tour',
    destination: draft.destination.trim(),
    description: draft.tourInstructions.trim() || undefined,
    category: 'Tour',
    templateKey: 'educational_tour',
    source: 'Event',
    academicYear: editing?.academicYear,
    targetClassIds: draft.targetClassIds,
    deadline: draft.deadline,
    eventDate: draft.eventDate || undefined,
    tourEndDate: draft.tourEndDate || undefined,
    durationDays: draft.durationDays,
    circularNo: draft.circularNo,
    circularDate: draft.circularDate || undefined,
    accompanyingStaff: draft.accompanyingStaff,
    tourInstructions: draft.tourInstructions,
    genderEligibility: draft.genderEligibility,
    paymentAvailability: draft.paymentAvailability,
    docTemplate: draft.docTemplate,
    participation: 'Optional',
    guardianConsentRequired: true,
    guardianConsentMethod: 'Digital',
    consentStatement: APPLICATION_TEMPLATES.educational_tour.consentStatement,
    teacherApprovalRequired: false,
    physicalSignatureRequired: false,
    inChargeTeacherId: inChargeLocked ? teacherId : draft.inChargeTeacherId,
    inChargeName: inChargeLocked ? actorName : draft.inChargeName,
    paymentMode: draft.paymentAmount > 0 ? 'Required' : 'None',
    paymentAmount: Math.max(0, draft.paymentAmount),
    paymentFeeHeadLabel: draft.title.trim() || 'Educational Tour',
    formFields: TOUR_FORM_FIELDS.map((f) => ({ ...f })),
  })

  /** Save the session configuration (creates the instance on first save). */
  const saveDraft = () => {
    if (problems.length > 0) {
      toast.error('A few details are missing', { description: problems[0] })
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const res = updateApplication(editing.id, buildInput(), actorName, { actorRole, teacherId })
        if (!res.success) {
          toast.error('Could not save', { description: res.error })
          return
        }
        toast.success('Session details saved')
        onSaved(editing.id)
      } else {
        const res = createApplication(buildInput(), actorName, { actorRole, teacherId })
        if (!res.success || !res.application) {
          toast.error('Could not save', { description: res.error })
          return
        }
        toast.success('Draft saved — review the preview, then publish.', {
          description: 'The form stays a draft until you publish it for students.',
        })
        onSaved(res.application.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const publish = () => {
    const id = editing?.id
    if (!id) return
    setPublishOpen(false)
    const res = publishApplication(id, actorName, { actorRole, teacherId })
    if (res.success) {
      toast.success('Tour published — eligible students have been notified.', {
        description: `"${draft.title}" is now open for applications until ${draft.deadline}.`,
      })
      onPublished(id)
    } else {
      toast.error('Could not publish', { description: res.error })
    }
  }

  const submitForPrincipalApproval = () => {
    const id = editing?.id
    if (!id) return
    const res = submitForApproval(id, actorName, 'Teacher', 'Ready for review — please approve and publish.', { teacherId })
    if (res.success) {
      toast.success('Sent to the Principal for approval', { description: 'You will publish it once approved.' })
      onSaved(id)
    } else {
      toast.error('Could not send', { description: res.error })
    }
  }

  const canEdit = !editing || isApplicationEditable(editing)
  const effStatus = editing ? effectiveAppStatus(editing) : 'Draft'
  const isTeacherPending = actorRole === 'Teacher' && ['Pending Approval', 'Approved'].includes(editing?.status ?? '')
  const alreadyPublished = ['Published', 'Open', 'Closing Soon', 'Closed', 'Locked'].includes(effStatus)

  const [previewRef, previewZoom] = useFitA4Zoom<HTMLDivElement>()

  return (
    <div className="space-y-4 max-w-7xl mx-auto" data-testid="tour-config">
      {/* Header — back, title, DRAFT → PREVIEW → PUBLISH pipeline */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={onBack} aria-label="Back to Applications and Forms">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight truncate">
              {editing ? 'Configure session' : 'Use for a new session'}
            </h2>
            <p className="text-[11px] text-muted-foreground truncate">
              Educational Tour — Parent Consent Form · the printed layout stays fixed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {editing && <StatusBadge status={effStatus} />}
          <div className="hidden md:flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <PipelineChip active label="Draft" />
            <span aria-hidden="true">→</span>
            <PipelineChip active={!!draft.destination && !!draft.eventDate} label="Preview" />
            <span aria-hidden="true">→</span>
            <PipelineChip active={alreadyPublished} label="Publish" />
          </div>
        </div>
      </div>

      {/* Mobile form/preview toggle */}
      <div className="flex md:hidden rounded-lg border border-border bg-muted/40 p-0.5" role="tablist" aria-label="Configure or preview">
        {(['form', 'preview'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={mobileView === v}
            className={cn(
              'flex-1 rounded-md py-1.5 text-[11px] font-medium capitalize transition-colors',
              mobileView === v ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => setMobileView(v)}
          >
            {v === 'form' ? 'Session details' : 'A4 preview'}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-12 gap-4 items-start">
        {/* ── Left: session configuration ── */}
        <div className={cn('lg:col-span-7 space-y-4', mobileView === 'preview' && 'hidden md:block')}>
          {!canEdit && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              This tour is {effStatus.toLowerCase()} — session details are locked. Records and submissions stay on file.
            </p>
          )}

          <Group group="basics" icon={<Info className="h-3.5 w-3.5" />} title="Tour">
            <FieldRow>
              <Field label="Tour title" required>
                <Input
                  value={draft.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Educational Tour — Jaipur"
                  className="h-8 text-xs"
                  disabled={!canEdit}
                  aria-label="Tour title"
                />
              </Field>
              <Field label="Destination" required>
                <Input
                  value={draft.destination}
                  onChange={(e) => set('destination', e.target.value)}
                  placeholder="Jaipur, Rajasthan"
                  className="h-8 text-xs"
                  disabled={!canEdit}
                  aria-label="Destination"
                />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Duration">
                <Input
                  value={draft.durationDays}
                  onChange={(e) => set('durationDays', e.target.value)}
                  placeholder="3 Days / 2 Nights"
                  className="h-8 text-xs"
                  disabled={!canEdit}
                  aria-label="Duration"
                />
              </Field>
              <Field label="Gender eligibility">
                <Select value={draft.genderEligibility} onValueChange={(v) => set('genderEligibility', v as ConfigDraft['genderEligibility'])} disabled={!canEdit}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Gender eligibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All students</SelectItem>
                    <SelectItem value="Boys">Boys only</SelectItem>
                    <SelectItem value="Girls">Girls only</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>
            <Field label="Short tour information for parents">
              <Textarea
                value={draft.tourInstructions}
                onChange={(e) => set('tourInstructions', e.target.value)}
                placeholder="Reporting time, what to carry, conduct rules…"
                className="min-h-[64px] text-xs"
                disabled={!canEdit}
                aria-label="Tour information for parents"
              />
            </Field>
            {/* A4 document layout — chosen at creation, switchable while draft */}
            <Field label="Document template">
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-2.5">
                <DocTemplateThumb which={draft.docTemplate} scale={0.62} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">{TOUR_DOC_TEMPLATES[draft.docTemplate].label}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground leading-relaxed line-clamp-2">
                    {TOUR_DOC_TEMPLATES[draft.docTemplate].blurb}
                  </p>
                </div>
                {canEdit && !alreadyPublished ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] shrink-0"
                    onClick={() => setTemplatePickOpen(true)}
                  >
                    Change
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0 text-muted-foreground">Locked</Badge>
                )}
              </div>
            </Field>
          </Group>

          <Group group="schedule" icon={<CalendarDays className="h-3.5 w-3.5" />} title="Dates">
            <FieldRow>
              <Field label="Tour start date" required>
                <DatePicker
                  compact
                  value={draft.eventDate}
                  onChange={(v) => set('eventDate', v)}
                  placeholder="Start date"
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Tour end date">
                <DatePicker
                  compact
                  value={draft.tourEndDate}
                  onChange={(v) => set('tourEndDate', v)}
                  placeholder="End date"
                  minDate={draft.eventDate || undefined}
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Last date to apply" required>
                <DatePicker
                  compact
                  value={draft.deadline}
                  onChange={(v) => set('deadline', v)}
                  placeholder="Application deadline"
                  maxDate={draft.eventDate || undefined}
                  disabled={!canEdit}
                />
              </Field>
            </FieldRow>
          </Group>

          <Group group="circular" icon={<FileText className="h-3.5 w-3.5" />} title="Circular">
            <FieldRow>
              <Field label="Circular / reference no.">
                <Input
                  value={draft.circularNo}
                  onChange={(e) => set('circularNo', e.target.value)}
                  placeholder="GW/EDU/TOUR/2026-27/07"
                  className="h-8 text-xs"
                  disabled={!canEdit}
                  aria-label="Circular reference number"
                />
              </Field>
              <Field label="Circular date">
                <DatePicker
                  compact
                  value={draft.circularDate}
                  onChange={(v) => set('circularDate', v)}
                  placeholder="Circular date"
                  disabled={!canEdit}
                />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Teacher / tour in-charge" required={!inChargeLocked}>
                {inChargeLocked ? (
                  <Input value={actorName} readOnly className="h-8 text-xs bg-muted/50" aria-label="Tour in-charge" />
                ) : (
                  <Select
                    value={draft.inChargeTeacherId}
                    onValueChange={(v) => {
                      const t = teacherOptions.find((x) => x.id === v)
                      setDraft((d) => ({ ...d, inChargeTeacherId: v, inChargeName: t?.name ?? '' }))
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-8 text-xs" aria-label="Tour in-charge">
                      <SelectValue placeholder="Choose a teacher" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {teacherOptions.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Accompanying staff">
                <Input
                  value={draft.accompanyingStaff}
                  onChange={(e) => set('accompanyingStaff', e.target.value)}
                  placeholder="Ms. Kavita Joshi · Mr. Deepak Nair"
                  className="h-8 text-xs"
                  disabled={!canEdit}
                  aria-label="Accompanying staff"
                />
              </Field>
            </FieldRow>
          </Group>

          <Group group="eligibility" icon={<Users className="h-3.5 w-3.5" />} title="Eligibility">
            <Field label="Applicable classes" required>
              <div className="flex flex-wrap gap-1.5">
                {ACADEMIC_CLASSES.map((c) => {
                  const active = draft.targetClassIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${active ? 'Remove' : 'Add'} ${c.name}${c.stream ? ` ${c.stream}` : ''}`}
                      disabled={!canEdit}
                      className={cn(
                        'h-7 rounded-md border px-2 text-[11px] font-medium transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                        !canEdit && 'opacity-60 cursor-not-allowed',
                      )}
                      onClick={() => toggleClass(c.id)}
                    >
                      {c.name}{c.stream ? ` · ${c.stream}` : ''}
                    </button>
                  )
                })}
              </div>
            </Field>
          </Group>

          <Group group="fee" icon={<IndianRupee className="h-3.5 w-3.5" />} title="Tour fee & payment">
            <FieldRow>
              <Field label="Tour fee per student">
                <Input
                  type="number"
                  min={0}
                  value={draft.paymentAmount || ''}
                  onChange={(e) => set('paymentAmount', Number(e.target.value) || 0)}
                  placeholder="2500"
                  className="h-8 text-xs"
                  disabled={!canEdit || (editing?.status === 'Published' && !!editing.payment.chargeId)}
                  aria-label="Tour fee per student"
                />
              </Field>
              <Field label="Payment can be made by">
                <Select value={draft.paymentAvailability} onValueChange={(v) => set('paymentAvailability', v as ConfigDraft['paymentAvailability'])} disabled={!canEdit}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Payment availability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Both">Online and cash</SelectItem>
                    <SelectItem value="Online">Online only</SelectItem>
                    <SelectItem value="Cash">Cash at school only</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>
            <p className="text-[10px] text-muted-foreground">
              {draft.paymentAmount > 0
                ? `Students may submit the form first and pay ${formatINR(draft.paymentAmount)} later — unpaid submissions stay visible and are never rejected automatically. This fee is an application charge; it never mixes with tuition or annual fees.`
                : 'No tour fee — this form only collects the consent and information.'}
            </p>
            {editing?.status === 'Published' && editing.payment.chargeId && (
              <p className="text-[10px] text-muted-foreground">
                The fee is locked while the tour is published — the linked collection in Fee Management owns the amount.
              </p>
            )}
          </Group>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => printTourDocument()} disabled={problems.length > 0}>
                <Printer className="h-3.5 w-3.5" /> Print blank form
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { void downloadTourFormPDF(previewApp).then((ok) => { if (!ok) toast.error('Could not generate the form') }) }} disabled={problems.length > 0}>
                <FileText className="h-3.5 w-3.5" /> Download blank
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={saveDraft} disabled={saving}>
                  <Save className="h-3.5 w-3.5" /> {editing ? 'Save changes' : 'Save draft'}
                </Button>
              )}
              {actorRole === 'Principal' && (editing?.status === 'Draft' || editing?.status === 'Changes Requested' || editing?.status === 'Rejected' || editing?.status === 'Approved') && (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setPublishOpen(true)} disabled={problems.length > 0}>
                  <Send className="h-3.5 w-3.5" /> Publish for students
                </Button>
              )}
              {actorRole === 'Teacher' && editing?.status === 'Draft' && (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={submitForPrincipalApproval} disabled={problems.length > 0}>
                  <Send className="h-3.5 w-3.5" /> Send to Principal
                </Button>
              )}
            </div>
          </div>
          {problems.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Complete {problems.length === 1 ? 'one detail' : `${problems.length} details`} to enable print and publish.
            </p>
          )}
          {isTeacherPending && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10 px-3 py-2 text-[11px] text-sky-700 dark:text-sky-400">
              {editing?.status === 'Pending Approval'
                ? 'Waiting for the Principal\u2019s approval. You will publish it once approved.'
                : 'Approved by the Principal — you can publish it now.'}
            </p>
          )}
        </div>

        {/* ── Right: live A4 preview ── */}
        <div className={cn('lg:col-span-5', mobileView === 'form' && 'hidden md:block')}>
          <div className="lg:sticky lg:top-4">
            <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <p className="text-[11px] font-semibold flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" /> Live A4 preview
                </p>
                <Badge variant="outline" className="text-[9px] h-4 px-1.5">Official school form</Badge>
              </div>
              <div ref={previewRef} className="max-h-[70vh] overflow-auto p-2">
                <div style={{ zoom: previewZoom, width: 'fit-content', margin: '0 auto' }}>
                  <TourFormDocument app={previewApp} />
                </div>
              </div>
              <p className="px-3 py-1.5 text-[9.5px] text-muted-foreground border-t border-border">
                Exactly what prints on A4 paper — students, parents and the office see this document.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Document template switch (drafts only) */}
      <Dialog open={templatePickOpen} onOpenChange={setTemplatePickOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Document template</DialogTitle>
            <DialogDescription className="text-xs">
              Used for the blank form, students&rsquo; submitted forms, print and PDF. Locked once the session is published.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            {TOUR_DOC_TEMPLATE_ORDER.map((key) => {
              const t = TOUR_DOC_TEMPLATES[key]
              const selected = draft.docTemplate === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => set('docTemplate', key)}
                  aria-pressed={selected}
                  className={cn(
                    'relative rounded-xl border p-3 flex flex-col items-center text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary ring-1 ring-primary/30 shadow-sm'
                      : 'border-border hover:border-primary/25 hover:bg-muted/30',
                  )}
                >
                  {selected && (
                    <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <DocTemplateThumb which={key} />
                  <p className="mt-2.5 text-xs font-semibold">{t.label}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{t.blurb}</p>
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <Button size="sm" className="h-8 text-xs" onClick={() => setTemplatePickOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish confirmation */}
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Publish this tour for students?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {draft.destination ? <span>&ldquo;{draft.title}&rdquo; to {draft.destination} </span> : <span>&ldquo;{draft.title}&rdquo; </span>}
              for {draft.targetClassIds.length} class{draft.targetClassIds.length === 1 ? '' : 'es'}.
              {draft.paymentAmount > 0 ? ` A tour fee of ${formatINR(draft.paymentAmount)} will be collected as an application charge.` : ' No fee is charged.'}
              {' '}Eligible students receive a notification and can apply until {draft.deadline}. You can take it down anytime — every submission and payment stays on record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Keep as draft</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-xs" onClick={(e) => { e.preventDefault(); publish() }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Small building blocks ─────────────────────────────────────────────

function PipelineChip({ active, label }: { active?: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border px-1.5 py-0.5',
      active ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400' : 'border-border text-muted-foreground',
    )}>
      {label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="text-[9px] h-4 px-1.5 capitalize">{status}</Badge>
  )
}

function Group({ group, icon, title, children }: { group?: FieldGroup; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <motion.section
      data-field-group={group}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
        <h3 className="text-xs font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </motion.section>
  )
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-medium text-muted-foreground">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  )
}
