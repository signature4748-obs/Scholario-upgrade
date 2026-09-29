'use client'

/**
 * Teacher Profile Page — full-page workspace (Wave 2.3 §2–§4, §11 +
 * W2.3B §5–§8).
 *
 * Header: identity (name · employee ID · designation · department ·
 * status) + key actions. Tabs keep the three domains separate:
 *   Positions & Allocation → employment, teaching allocation,
 *                             responsibilities, permissions
 *   Profile                → photo / signature / personal details
 *   Payroll                → salary and payment history (untouched)
 *
 * The Profile tab is a VIEW screen first: the photograph renders as a
 * real employee portrait (never an admission-style upload form) with a
 * subtle edit affordance that opens the SAME capture/crop/upload pipeline
 * the Add Teacher wizard uses; the signature behaves the same way.
 */

import { useState } from 'react'
import {
  Lock, Unlock, ShieldAlert, ArrowLeft, FileCheck2, FileSignature,
  KeyRound, ChevronDown, Camera, Pencil, BadgeCheck, UserRoundPen,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import {
  type TeacherRecord,
  type PositionDefinition,
} from '@/lib/store/teachers-store'
import { gradientFor } from './shared'
import { TeacherPayrollTab } from './teacher-payroll-tab'
import { PositionsAllocationTab } from './positions-allocation-tab'
import { SecureTeacherImg } from './secure-teacher-media'
import {
  PersonalEditDialog, PhotoEditDialog, SignatureEditDialog,
} from './profile-edit-dialogs'

interface Props {
  teacher: TeacherRecord
  positionsList: PositionDefinition[]
  onBack: () => void
  onOpenAppointment: () => void
  onOpenJoiningLetter: () => void
  onResetPassword: () => void
  onToggleLock: () => void
  onOpenTermination: () => void
  /** Opens the module's WorkloadAllocationModal pre-targeted at this teacher. */
  onManageWorkload: (t: TeacherRecord) => void
  /** Opens the module's AssignPositionModal pre-targeted at this teacher. */
  onManageResponsibilities: (t: TeacherRecord) => void
}

export function TeacherProfilePage({
  teacher, positionsList, onBack,
  onOpenAppointment, onOpenJoiningLetter, onResetPassword, onToggleLock, onOpenTermination,
  onManageWorkload, onManageResponsibilities,
}: Props) {
  return (
    <div className="space-y-5">
      {/* ============ HEADER ============ */}
      <div className="flex items-start gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0" aria-label="Back to directory">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {teacher.photo ? (
            <SecureTeacherImg
              record={teacher.photo}
              alt={teacher.name}
              className="h-12 w-12 shrink-0 rounded-xl object-cover border border-border"
            />
          ) : (
            <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white font-semibold', gradientFor(teacher.id))}>
              {teacher.avatar}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{teacher.name}</h1>
              <StatusBadge status={teacher.status} variant={teacher.status === 'Active' ? 'success' : 'warning'} />
              {teacher.isLocked && (
                <Badge variant="destructive" className="text-[10px]">
                  <Lock className="h-2.5 w-2.5 mr-1" /> Locked
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {teacher.designation} · {teacher.department} · <span className="font-mono">{teacher.employeeId}</span>
            </p>
          </div>
        </div>

        {/* Key actions */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5">
                <FileCheck2 className="h-3.5 w-3.5" /> Documents <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={onOpenAppointment} className="gap-2 text-xs">
                <FileCheck2 className="h-3.5 w-3.5" /> Appointment Letter
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenJoiningLetter} className="gap-2 text-xs">
                <FileSignature className="h-3.5 w-3.5" /> Joining Letter
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onResetPassword} className="gap-2 text-xs">
                <KeyRound className="h-3.5 w-3.5" /> Account Slip
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={onToggleLock}
            className={cn('text-xs h-8 gap-1.5', teacher.isLocked && 'border-amber-500 text-amber-700 hover:bg-amber-50')}>
            {teacher.isLocked ? <Unlock className="h-3.5 w-3.5 text-amber-600" /> : <Lock className="h-3.5 w-3.5 text-slate-500" />}
            {teacher.isLocked ? 'Unlock' : 'Lock'}
          </Button>
          <Button variant="destructive" size="sm" onClick={onOpenTermination} className="text-xs h-8 gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" /> Relieve
          </Button>
        </div>
      </div>

      {/* ============ TABS ============ */}
      <Tabs defaultValue="positions">
        <TabsList className="bg-muted/60 h-9 p-1 gap-1 rounded-full inline-flex">
          <TabsTrigger value="positions" className="text-xs rounded-full px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground">Positions &amp; Allocation</TabsTrigger>
          <TabsTrigger value="profile" className="text-xs rounded-full px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground">Profile</TabsTrigger>
          <TabsTrigger value="payroll" className="text-xs rounded-full px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground">Payroll</TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="mt-4">
          <PositionsAllocationTab
            teacher={teacher}
            positionsList={positionsList}
            onManageWorkload={onManageWorkload}
            onManageResponsibilities={onManageResponsibilities}
          />
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab teacher={teacher} />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          <TeacherPayrollTab teacherId={teacher.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ================================================================== */
/*  TAB 2 — PROFILE (view first, edit through focused dialogs)         */
/* ================================================================== */

function ProfileTab({ teacher }: { teacher: TeacherRecord }) {
  const [photoEditOpen, setPhotoEditOpen] = useState(false)
  const [signatureEditOpen, setSignatureEditOpen] = useState(false)
  const [personalEditOpen, setPersonalEditOpen] = useState(false)

  return (
    <div className="space-y-6">
      {/* ---------- Photo & signature — profile portrait area ---------- */}
      <section aria-label="Photo and signature" className="flex flex-col sm:flex-row gap-6">
        {/* PHOTO — State A: actual photo + subtle edit overlay.
                       State B: initials portrait + Add photo secondary action. */}
        <div className="flex items-end gap-3">
          <div className="group relative shrink-0">
            {teacher.photo ? (
              <SecureTeacherImg
                record={teacher.photo}
                alt={`${teacher.name} — staff photograph`}
                className="h-32 w-28 rounded-xl object-cover border border-border shadow-sm"
              />
            ) : (
              <div className={cn('relative h-32 w-28 rounded-xl bg-gradient-to-br border border-border/60 shadow-sm overflow-hidden', gradientFor(teacher.id))}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl font-semibold text-white">{teacher.avatar}</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setPhotoEditOpen(true)}
              aria-label={teacher.photo ? `Edit ${teacher.name}'s photo` : `Add a photo for ${teacher.name}`}
              title={teacher.photo ? 'Edit photo' : 'Add photo'}
              className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {teacher.photo ? <Pencil className="h-3 w-3" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="pb-1">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Photograph</p>
            {teacher.photo ? (
              <p className="text-[11px] text-muted-foreground mt-1 max-w-[180px] leading-snug">
                Passport photo on file · uploaded {formatDate(teacher.photo.uploadedAt)}
              </p>
            ) : (
              <Button
                variant="outline" size="sm" onClick={() => setPhotoEditOpen(true)}
                className="text-xs h-7 px-2.5 gap-1.5 mt-1.5 text-muted-foreground"
              >
                <Camera className="h-3 w-3" /> Add photo
              </Button>
            )}
          </div>
        </div>

        {/* SIGNATURE — subtle preview + edit; compact empty state */}
        <div className="flex-1 min-w-0 sm:border-l sm:border-border sm:pl-6">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider mb-2">Signature</p>
          {teacher.signature ? (
            <div className="flex items-start gap-3 flex-wrap">
              <div className="rounded-lg border border-border bg-white p-1.5 shadow-xs">
                <SecureTeacherImg
                  record={teacher.signature}
                  alt={`${teacher.name}'s signature`}
                  className="h-14 w-36 object-contain"
                />
              </div>
              <Button
                variant="ghost" size="sm" onClick={() => setSignatureEditOpen(true)}
                className="text-xs h-7 px-2 gap-1 text-muted-foreground hover:text-foreground"
                aria-label={`Edit ${teacher.name}'s signature`}
              >
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground italic">Not added</p>
              <Button
                variant="outline" size="sm" onClick={() => setSignatureEditOpen(true)}
                className="text-xs h-7 px-2.5 gap-1.5 text-muted-foreground"
              >
                <FileSignature className="h-3 w-3" /> Add signature
              </Button>
            </div>
          )}
          {teacher.signature && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Used on official documents and records · uploaded {formatDate(teacher.signature.uploadedAt)}
            </p>
          )}
        </div>
      </section>

      {/* ---------- Personal & professional details ---------- */}
      <section aria-label="Personal details" className="pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserRoundPen className="h-3.5 w-3.5" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Personal Information</h3>
          </div>
          <Button
            variant="ghost" size="sm" onClick={() => setPersonalEditOpen(true)}
            className="text-xs h-7 px-2 gap-1 text-muted-foreground hover:text-foreground"
            aria-label={`Edit personal information for ${teacher.name}`}
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <ProfileField label="Email" value={teacher.email} mono />
          <ProfileField label="Phone" value={teacher.phone} mono />
          <ProfileField label="Date of Birth" value={formatDate(teacher.dob)} />
          <ProfileField label="Blood Group" value={teacher.bloodGroup} />
          <ProfileField label="Experience" value={`${teacher.totalExperience} years`} />
          <ProfileField label="Employment Type" value={teacher.employmentType} />
          <ProfileField label="Qualifications" value={teacher.educationalQualifications.map((q) => `${q.degree} (${q.institution})`).join(', ')} />
          <ProfileField label="Address" value={teacher.currentAddress} />
          <ProfileField label="Emergency Contact" value={teacher.emergencyContact.name ? `${teacher.emergencyContact.name} (${teacher.emergencyContact.relation}) · ${teacher.emergencyContact.phone}` : '—'} />
        </div>
      </section>

      {/* ---------- edit dialogs (shared secure pipelines) ---------- */}
      <PhotoEditDialog teacher={teacher} open={photoEditOpen} onClose={() => setPhotoEditOpen(false)} />
      <SignatureEditDialog teacher={teacher} open={signatureEditOpen} onClose={() => setSignatureEditOpen(false)} />
      <PersonalEditDialog teacher={teacher} open={personalEditOpen} onClose={() => setPersonalEditOpen(false)} />
    </div>
  )
}

/* Single-line profile field — label + value, no card background */
function ProfileField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">{label}</p>
      <p className={cn('text-sm font-medium text-foreground mt-1 break-words', mono && 'font-mono')}>{value}</p>
    </div>
  )
}
