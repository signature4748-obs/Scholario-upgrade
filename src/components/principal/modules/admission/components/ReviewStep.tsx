'use client'

/**
 * Wizard Step 10 — Review & Submit.
 *
 * The single source of truth for WHAT WILL BE SUBMITTED: every part of
 * the application (Student / Parents / Address / Academic / Previous
 * School / Transport / Fee / Photo / Documents) appears as a section
 * with an honest status — Complete ✓, Incomplete, or Optional — and an
 * Edit jump. The actual captured photo and the canonical document
 * completion summary are shown here (not just "Photo ✓").
 */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Users, MapPin, GraduationCap, School as SchoolIcon, Bus,
  Wallet, Camera, FileText, Pencil, ChevronDown,
  CheckCircle2, AlertCircle, MinusCircle, ImageIcon,
} from 'lucide-react'
import { useSchoolProfile } from '@/lib/school-profile'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAdmissionFeatureFlags, useAdmissionDocumentPolicy } from '../lib/admission-utils'
import { getDocumentCompletion, getCollectedDocuments } from '../lib/documents'
import { useFeeCalculations } from '../../FeeStructureStep/useFeeCalculations'
import { defaultFeeDataState } from '../../FeeStructureStep/types'
import type { FormData } from '../constants'

type SectionStatus = 'complete' | 'incomplete' | 'optional'

function StatusChip({ status }: { status: SectionStatus }) {
  if (status === 'complete')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Complete
      </span>
    )
  if (status === 'incomplete')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
        <AlertCircle className="h-3.5 w-3.5" /> Incomplete
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      <MinusCircle className="h-3.5 w-3.5" /> Optional
    </span>
  )
}

interface SectionDef {
  id: string
  step: number
  icon: typeof User
  status: SectionStatus
  rows: { label: string; value: string }[]
  custom?: 'photo' | 'documents' | 'fee'
}

export function ReviewStep({
  data,
  flags,
  onJumpTo,
}: {
  data: FormData
  flags: ReturnType<typeof useAdmissionFeatureFlags>
  set: <K extends keyof FormData>(k: K, v: FormData[K]) => void
  onJumpTo: (step: number) => void
}) {
  const [viewMode, setViewMode] = useState<'summary' | 'official'>('summary')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Official-preview letterhead — the identity cascade, never a demo school.
  const school = useSchoolProfile()
  const documentPolicy = useAdmissionDocumentPolicy()
  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const docCompletion = getDocumentCompletion(data.docStatuses, documentPolicy)
  const collectedDocs = useMemo(() => getCollectedDocuments(documentPolicy), [documentPolicy])
  const fee = useFeeCalculations(
    data.className || '',
    data.feeState || defaultFeeDataState,
    () => {},
    { enableTransport: flags.enableTransport, enableHostel: flags.enableHostel }
  )

  const fullName = `${data.firstName} ${data.lastName}`.trim()
  const hasPhoto = !!data.photoDataUrl

  const inr = (n: number) =>
    `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  const sections: SectionDef[] = [
    {
      id: 'Personal', step: 1, icon: User,
      status: data.firstName && data.dob && data.gender ? 'complete' : 'incomplete',
      rows: [
        { label: 'Name', value: fullName || '—' },
        { label: 'DOB', value: data.dob ? formatDate(data.dob) : '—' },
        { label: 'Gender', value: data.gender || '—' },
        ...(flags.enableBloodGroup && data.bloodGroup ? [{ label: 'Blood Group', value: data.bloodGroup }] : []),
        ...(flags.enableAadhaar && data.aadhaarNo ? [{ label: 'Aadhaar', value: `XXXX-XXXX-${data.aadhaarNo.slice(-4)}` }] : []),
      ],
    },
    {
      id: 'Parents', step: 2, icon: Users,
      status: (data.fatherName || data.motherName) && (data.fatherPhone || data.motherPhone) ? 'complete' : 'incomplete',
      rows: [
        { label: "Father", value: data.fatherName || '—' },
        { label: 'Father Phone', value: data.fatherPhone || '—' },
        { label: 'Mother', value: data.motherName || '—' },
        { label: 'Emergency', value: data.emergencyName || '—' },
      ],
    },
    {
      id: 'Address', step: 3, icon: MapPin,
      // Matches the ACTUAL Address step fields (line / district / PIN) —
      // the form collects no city field, so city must not gate completion.
      status: data.currentAddress && data.district && data.pincode ? 'complete' : 'incomplete',
      rows: [
        { label: 'Current', value: [data.currentAddress, data.district, data.state].filter(Boolean).join(', ') || '—' },
        { label: 'PIN', value: data.pincode || '—' },
      ],
    },
    {
      id: 'Academic', step: 4, icon: GraduationCap,
      status: data.className ? 'complete' : 'incomplete',
      rows: [
        { label: 'Session', value: data.previousYear || '—' },
        { label: 'Class', value: data.className || '—' },
        { label: 'Section', value: data.section || 'No preference' },
        ...(data.waitlisted ? [{ label: 'Status', value: 'Waitlisted' }] : []),
      ],
    },
    {
      id: 'Previous School', step: 5, icon: SchoolIcon,
      status: data.previousSchool ? 'complete' : 'optional',
      rows: data.previousSchool || data.previousClass ? [
        { label: 'School', value: data.previousSchool || '—' },
        { label: 'Last Class', value: data.previousClass || '—' },
        ...(data.tcNumber ? [{ label: 'TC No.', value: data.tcNumber }] : []),
      ] : [{ label: 'Previous school', value: 'Not provided' }],
    },
    ...((flags.enableTransport || flags.enableHostel)
      ? [{
          id: 'Transport', step: 6, icon: Bus,
          status: (data.transportRequired || data.hostelRequired) ? 'complete' : 'optional' as SectionStatus,
          rows: (data.transportRequired || data.hostelRequired) ? [
            { label: 'Transport', value: data.transportRequired ? data.transportRoute || 'Yes' : 'No' },
            ...(data.hostelRequired ? [{ label: 'Hostel', value: data.hostelRoomType || 'Yes' }] : []),
          ] : [{ label: 'Transport & hostel', value: 'Not required' }],
        }]
      : []),
    {
      id: 'Fee', step: 7, icon: Wallet,
      status: 'complete',
      rows: [
        { label: 'Gross', value: inr(fee.grossFee) },
        ...(fee.totalDiscount > 0 ? [{ label: 'Discount', value: `− ${inr(fee.totalDiscount)}` }] : []),
        { label: 'Net Payable', value: inr(fee.netTotal) },
        { label: 'First Installment', value: inr(fee.initialInstallment) },
      ],
    },
    ...((flags.enableStudentPhoto && !hasPhoto)
      ? [{ id: 'Photo', step: 8, icon: Camera, status: 'optional' as SectionStatus, rows: [{ label: 'Photo', value: 'No photo selected' }] }]
      : []),
    // Documents section appears only when the school collects documents.
    ...(collectedDocs.length > 0
      ? [{
          id: 'Documents', step: 9, icon: FileText,
          status: (docCompletion.complete ? 'complete' : 'incomplete') as SectionStatus,
          rows: [] as { label: string; value: string }[],
          custom: 'documents' as const,
        }]
      : []),
  ]

  const incomplete = sections.filter((s) => s.status === 'incomplete')

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl w-fit">
        <button type="button" onClick={() => setViewMode('summary')} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all', viewMode === 'summary' ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground')}>
          Summary
        </button>
        <button type="button" onClick={() => setViewMode('official')} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all', viewMode === 'official' ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground')}>
          Official Form
        </button>
      </div>

      {/* Summary view */}
      {viewMode === 'summary' && (
        <div className="space-y-4">
          {/* Applicant identity + ACTUAL photo */}
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
            {hasPhoto ? (
              <img
                src={data.photoDataUrl!}
                alt={`${fullName || 'Applicant'} photo`}
                className="h-14 w-14 rounded-xl object-cover border border-border shrink-0"
              />
            ) : (
              <div className="h-14 w-14 rounded-xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center shrink-0">
                <ImageIcon className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg text-foreground truncate">{fullName || 'Unnamed applicant'}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {data.className} {data.section ? `— ${data.section}` : ''} · {data.previousYear || school.academicYear || '—'}
              </p>
            </div>
            {flags.enableStudentPhoto && (
              <button
                type="button"
                onClick={() => onJumpTo(8)}
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:bg-primary/10 rounded-md px-2 py-1 transition-colors shrink-0"
              >
                <Camera className="h-3 w-3" /> {hasPhoto ? 'Replace' : 'Add'}
              </button>
            )}
          </div>

          {/* Blocker notice — honest, actionable */}
          {incomplete.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-foreground leading-relaxed">
                <span className="font-semibold">
                  {incomplete.length === 1
                    ? 'One section still needs attention:'
                    : `${incomplete.length} sections still need attention:`}{' '}
                </span>
                <span className="text-muted-foreground">
                  {incomplete.map((s) => s.id).join(' · ')}
                </span>
              </p>
            </div>
          )}

          <div className="space-y-2.5">
            {sections.map((section) => {
              const Icon = section.icon
              const isOpen = !collapsed.has(section.id)
              return (
                <div key={section.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSection(section.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(section.id) } }}
                    className="w-full flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-sm truncate">{section.id}</span>
                      <StatusChip status={section.status} />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onJumpTo(section.step) }}
                        className="flex items-center gap-1 text-[11px] font-medium text-primary hover:bg-primary/10 rounded-md px-2 py-1 transition-colors"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                    </div>
                  </div>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-3.5 pt-0 space-y-1.5">
                          {section.custom === 'documents' ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 text-xs">
                                <span className={cn('font-semibold', docCompletion.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                                  {docCompletion.badgeLabel}
                                </span>
                                <span className="text-muted-foreground">· {docCompletion.summaryLine}</span>
                              </div>
                              {Object.entries(data.docStatuses)
                                .filter(
                                  ([key, st]) =>
                                    (st.status === 'received' || st.status === 'uploaded') &&
                                    collectedDocs.some((d) => d.key === key)
                                )
                                .map(([key, st]) => {
                                  const name = collectedDocs.find((d) => d.key === key)?.name || key
                                  return (
                                    <div key={key} className="flex justify-between items-start text-xs gap-2">
                                      <span className="text-muted-foreground shrink-0">{name}:</span>
                                      <span className="font-medium text-foreground text-right font-mono text-[11px] truncate">{st.fileName || 'received'}</span>
                                    </div>
                                  )
                                })}
                            </div>
                          ) : section.custom === 'photo' ? null : (
                            section.rows.map((row) => (
                              <div key={row.label} className="flex justify-between items-start text-xs gap-2">
                                <span className="text-muted-foreground shrink-0">{row.label}:</span>
                                <span className="font-medium text-foreground text-right">{row.value}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Official Form view */}
      {viewMode === 'official' && (
        <div className="rounded-2xl border-2 border-border bg-card p-6 space-y-4 shadow-sm">
          <div className="flex items-start justify-between border-b-2 border-foreground/20 pb-3 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-foreground text-background font-display text-xl font-black">{school.shortName.charAt(0)}</div>
              <div>
                <h2 className="font-bold text-base uppercase tracking-wide">{school.name}</h2>
                <p className="text-[10px] text-muted-foreground">{school.affiliation || '—'}</p>
              </div>
            </div>
            <div className="text-right text-[10px]">
              <p className="font-bold text-primary">FORM NO: ADM-{school.academicYear || '____'}</p>
              <p className="text-muted-foreground">{school.academicYear || '—'}</p>
            </div>
          </div>

          <div className="text-center bg-muted/40 py-1.5 rounded-lg border border-border">
            <h3 className="font-bold text-xs uppercase tracking-widest">STUDENT ADMISSION FORM</h3>
          </div>

          <div className="grid sm:grid-cols-[1fr_100px] gap-4">
            <div className="space-y-3">
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-primary border-b border-border pb-0.5 mb-1.5">Personal</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
                  <div><span className="text-muted-foreground">Name:</span> <strong className="block">{fullName}</strong></div>
                  <div><span className="text-muted-foreground">DOB:</span> <strong className="block">{data.dob ? formatDate(data.dob) : '—'}</strong></div>
                  <div><span className="text-muted-foreground">Gender:</span> <strong className="block">{data.gender || '—'}</strong></div>
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-primary border-b border-border pb-0.5 mb-1.5">Parents</h4>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <div><span className="text-muted-foreground">Father:</span> <strong className="block">{data.fatherName || '—'}</strong></div>
                  <div><span className="text-muted-foreground">Phone:</span> <strong className="block">{data.fatherPhone || '—'}</strong></div>
                  <div><span className="text-muted-foreground">Mother:</span> <strong className="block">{data.motherName || '—'}</strong></div>
                  <div><span className="text-muted-foreground">Emergency:</span> <strong className="block">{data.emergencyName || '—'}</strong></div>
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-primary border-b border-border pb-0.5 mb-1.5">Address & Academic</h4>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <div><span className="text-muted-foreground">Address:</span> <strong className="block">{[data.currentAddress, data.city, data.state].filter(Boolean).join(', ') || '—'}</strong></div>
                  <div><span className="text-muted-foreground">Class:</span> <strong className="block">{data.className} {data.section ? `- ${data.section}` : ''}</strong></div>
                  <div><span className="text-muted-foreground">Prev School:</span> <strong className="block">{data.previousSchool || '—'}</strong></div>
                  <div><span className="text-muted-foreground">Transport:</span> <strong className="block">{data.transportRequired ? data.transportRoute || 'Yes' : 'No'}</strong></div>
                </div>
              </div>
            </div>
            {/* Actual captured photo — the same photo persisted from Step 8 */}
            <div className="flex flex-col items-center">
              <div className="h-28 w-24 rounded-lg border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                {hasPhoto ? (
                  <img src={data.photoDataUrl!} alt={`${fullName} photo`} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[9px] text-muted-foreground text-center px-1">AFFIX PHOTO</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 pt-4 border-t border-border text-center text-[10px]">
            <div><div className="h-6 border-b border-foreground/40 mb-1" /><p className="font-medium">Parent Signature</p></div>
            <div><div className="h-6 border-b border-foreground/40 mb-1" /><p className="font-medium">Principal Signature</p></div>
          </div>
        </div>
      )}
    </div>
  )
}
