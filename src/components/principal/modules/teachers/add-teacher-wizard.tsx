'use client'

import { useState, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UserPlus, CheckCircle2,
  User, GraduationCap, Wallet, Shield, Camera, Pencil, ChevronDown,
  MapPin, Mail, } from 'lucide-react'
import { GlassCard } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { formatINR, formatDate } from '@/lib/format'
import type { TeacherRecord } from '@/lib/store/teachers-store'
import {
  initialFormState,
  masterInchargePositions,
  availableClassesList,
  subjectList,
  buildNewTeacherRecord,
  type AddTeacherForm,
} from './add-teacher-data'
import { Step1BasicInfo, Step2Qualifications, Step3Appointment, Step4Academic } from './add-teacher-steps'
import { Step5PhotoSignature } from './add-teacher-step-photo'
import { StepperHeader, type WizardStep } from '../admission/components/StepperHeader'
import { NavigationControls } from '../admission/components/NavigationControls'
import { cn } from '@/lib/utils'

interface Props {
  onSuccess: (teacher: TeacherRecord) => void
  onCancel?: () => void
}

const TEACHER_STEPS: WizardStep[] = [
  { id: 1, label: 'Basic Info', icon: User },
  { id: 2, label: 'Qualifications', icon: GraduationCap },
  { id: 3, label: 'Appointment', icon: Wallet },
  { id: 4, label: 'Academic', icon: Shield },
  { id: 5, label: 'Photo & Sign', icon: Camera },
  { id: 6, label: 'Review', icon: CheckCircle2 },
]

export function AddTeacherWizard({ onSuccess, onCancel }: Props) {
  const { teachers } = useTeachersStore()

  const assignedInchargePositions = useMemo(() => {
    const taken = new Set<string>()
    teachers.forEach((t) => {
      if (t.status === 'Active') {
        t.positions?.forEach((p) => { if (p.status === 'Active' && p.positionTitle) taken.add(p.positionTitle) })
        if (t.department && t.department !== 'Academic') taken.add(t.department)
      }
    })
    return taken
  }, [teachers])

  const availableInchargePositions = useMemo(
    () => masterInchargePositions.filter((pos) => !assignedInchargePositions.has(pos)),
    [assignedInchargePositions],
  )

  const classesWithClassTeacher = useMemo(() => {
    const taken = new Set<string>()
    teachers.forEach((t) => {
      if (t.status === 'Active') {
        if (t.designation?.includes('Class Teacher')) {
          const m = t.designation.match(/\(([^)]+)\)/)
          if (m?.[1]) taken.add(m[1])
        }
        t.positions?.forEach((p) => {
          if (p.status === 'Active' && p.positionTitle?.includes('Class Teacher')) {
            const m = p.positionTitle.match(/\(([^)]+)\)/)
            if (m?.[1]) taken.add(m[1])
          }
        })
      }
    })
    return taken
  }, [teachers])

  const classesWithAsstClassTeacher = useMemo(() => {
    const taken = new Set<string>()
    teachers.forEach((t) => {
      if (t.status === 'Active') {
        t.positions?.forEach((p) => {
          if (p.status === 'Active' && p.positionTitle?.includes('Assistant Class Teacher')) {
            const m = p.positionTitle.match(/\(([^)]+)\)/)
            if (m?.[1]) taken.add(m[1])
          }
        })
      }
    })
    return taken
  }, [teachers])

  const [step, setStep] = useState(1)
  const [form, setForm] = useState<AddTeacherForm>(initialFormState)
  const stepperScrollRef = useRef<HTMLDivElement>(null)

  const setF = (key: string, val: any) => setForm((prev) => ({ ...prev, [key]: val }))

  const toggleClass = (cls: string) => {
    setForm((prev) => {
      const ex = prev.selectedClasses.includes(cls)
      return { ...prev, selectedClasses: ex ? prev.selectedClasses.filter((c) => c !== cls) : [...prev.selectedClasses, cls] }
    })
  }
  const toggleSubject = (sub: string) => {
    setForm((prev) => {
      const ex = prev.selectedSubjects.includes(sub)
      return { ...prev, selectedSubjects: ex ? prev.selectedSubjects.filter((s) => s !== sub) : [...prev.selectedSubjects, sub] }
    })
  }

  const currentVisibleIndex = TEACHER_STEPS.findIndex((s) => s.id === step)

  const handleBack = () => {
    if (currentVisibleIndex > 0) setStep(TEACHER_STEPS[currentVisibleIndex - 1].id)
  }
  const handleNext = () => {
    if (currentVisibleIndex < TEACHER_STEPS.length - 1) setStep(TEACHER_STEPS[currentVisibleIndex + 1].id)
  }
  const handleSubmit = () => {
    onSuccess(buildNewTeacherRecord(form))
  }

  const stepProps = { form, setF }
  const step4Props = {
    ...stepProps,
    availableInchargePositions, availableClassesList,
    classesWithClassTeacher, classesWithAsstClassTeacher,
    subjectList, toggleClass, toggleSubject,
  }

  return (
    <>
      {/* Stepper Header — same as Admissions */}
      <StepperHeader
        visibleSteps={TEACHER_STEPS}
        step={step}
        currentVisibleIndex={currentVisibleIndex}
        stepperScrollRef={stepperScrollRef}
        onSelect={setStep}
      />

      {/* Step content — animated transitions matching Admissions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.25 }}
        >
          <GlassCard className="p-4 sm:p-6">
            {step === 1 && <Step1BasicInfo {...stepProps} />}
            {step === 2 && <Step2Qualifications {...stepProps} />}
            {step === 3 && <Step3Appointment {...stepProps} />}
            {step === 4 && <Step4Academic {...step4Props} />}
            {step === 5 && <Step5PhotoSignature form={form} setF={setF} />}

            {/* STEP 6 — Review (Admissions-style collapsible section cards, single view) */}
            {step === 6 && <TeacherReviewStep form={form} onJumpTo={setStep} />}
          </GlassCard>
        </motion.div>
      </AnimatePresence>

      {/* Navigation Controls — same as Admissions */}
      <NavigationControls
        visibleSteps={TEACHER_STEPS}
        step={step}
        currentVisibleIndex={currentVisibleIndex}
        onBack={handleBack}
        onNext={handleNext}
        onSubmit={handleSubmit}
        submitLabel="Create Teacher"
        submitIcon={UserPlus}
      />

      {/* Cancel button — separate from the main nav */}
      {onCancel && (
        <div className="mt-2 text-center">
          <Button variant="ghost" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Teacher Review Step — matches Admissions Review (collapsible      */
/*  section cards with icon + title + Edit button + chevron).         */
/*  NO Digital/Official toggle — single clean view only.              */
/* ------------------------------------------------------------------ */

function TeacherReviewStep({ form, onJumpTo }: { form: AddTeacherForm; onJumpTo: (step: number) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const initials = (form.name || '?').split(' ').map((n) => n[0] || '?').join('').slice(0, 2).toUpperCase()

  const sections = [
    { id: 'Basic Info', step: 1, icon: User, rows: [
      { label: 'Name', value: form.name || '—' },
      { label: 'Gender', value: form.gender || '—' },
      { label: 'DOB', value: form.dob ? formatDate(form.dob) : '—' },
      { label: 'Blood Group', value: form.bloodGroup || '—' },
      { label: 'Aadhaar', value: form.aadhaarNo || '—' },
    ]},
    { id: 'Contact', step: 1, icon: Mail, rows: [
      { label: 'Email', value: form.email || '—' },
      { label: 'Phone', value: form.phone || '—' },
      { label: 'Emergency Contact', value: form.emergencyName || '—' },
      { label: 'Emergency Phone', value: form.emergencyPhone || '—' },
    ]},
    { id: 'Address', step: 1, icon: MapPin, rows: [
      { label: 'Address Line', value: form.currentAddress || '—' },
      { label: 'District', value: form.district || '—' },
      { label: 'State', value: form.state || '—' },
      { label: 'PIN', value: form.pincode || '—' },
      { label: 'Country', value: 'India' },
    ]},
    { id: 'Qualifications', step: 2, icon: GraduationCap, rows: [
      { label: 'Degree', value: form.degree || '—' },
      { label: 'Specialization', value: form.specialization || '—' },
      { label: 'Institution', value: form.institution || '—' },
      { label: 'Certifications', value: form.profQualifications || '—' },
      { label: 'Experience', value: form.totalExperience ? `${form.totalExperience} years` : '—' },
      { label: 'Previous School', value: form.prevOrg || '—' },
    ]},
    { id: 'Employment', step: 3, icon: Wallet, rows: [
      { label: 'Joining Date', value: form.joiningDate ? formatDate(form.joiningDate) : '—' },
      { label: 'Employment Type', value: form.employmentType || '—' },
      { label: 'Salary', value: form.salary ? `${formatINR(Number(form.salary))}/mo` : '—' },
      { label: 'Bank', value: form.bankName || '—' },
      { label: 'Account No', value: form.accountNo || '—' },
      { label: 'IFSC', value: form.ifscCode || '—' },
    ]},
    { id: 'Academic Assignment', step: 4, icon: Shield, rows: [
      { label: 'Incharge Position', value: form.inchargePosition !== 'None' ? form.inchargePosition : '—' },
      { label: 'Class Teacher', value: form.classTeacherRole !== 'None' ? form.classTeacherRole : '—' },
      { label: 'Asst. Class Teacher', value: form.assistantClassTeacherRole !== 'None' ? form.assistantClassTeacherRole : '—' },
      { label: 'Subjects', value: form.selectedSubjects.length ? form.selectedSubjects.join(', ') : '—' },
      { label: 'Classes', value: form.selectedClasses.length ? form.selectedClasses.join(', ') : '—' },
    ]},
    ...(form.photo || form.signature ? [{ id: 'Photo & Signature', step: 5, icon: Camera, rows: [
      { label: 'Photo', value: form.photo ? 'Captured & stored' : '—' },
      { label: 'Signature', value: form.signature ? 'Uploaded & stored' : '—' },
    ]}] : []),
  ]

  return (
    <div className="space-y-4">
      {/* Profile card — same as Admissions */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
        {form.photo?.dataUrl ? (
          <img src={form.photo.dataUrl} alt={form.name} className="h-14 w-14 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-display text-lg font-bold">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg text-foreground">{form.name || 'New Teacher'}</h3>
          <p className="text-xs text-muted-foreground">
            {form.employmentType} · {form.joiningDate ? formatDate(form.joiningDate) : 'Joining date not set'}
          </p>
        </div>
      </div>

      {/* Collapsible section cards — identical pattern to Admissions Review */}
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
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="font-semibold text-sm">{section.id}</span>
                </div>
                <div className="flex items-center gap-2">
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
                      {section.rows.map((row) => (
                        <div key={row.label} className="flex justify-between items-start text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">{row.label}:</span>
                          <span className="font-medium text-foreground text-right">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
