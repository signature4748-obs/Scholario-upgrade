'use client'

/**
 * SS-1 — Settings → Profile.
 *
 * Two clear zones:
 *   1. Your photo — the ONE thing the student owns and can change
 *      (uploaded securely, school-scoped serving).
 *   2. Official student information — every field marked "Managed by
 *      school" with the honest correction path (contact the office).
 * No fake edit affordances on school-managed data.
 */
import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Camera, Trash2, Upload, Info } from 'lucide-react'
import { Avatar } from '@/components/shared/avatar'
import { Button } from '@/components/ui/button'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { useMyStudentRecord } from '@/lib/store/students-store'
import { useAvatarUpload } from './hooks'
import { SectionCard, InfoRow, ManagedBadge } from './primitives'

const ACCEPTED = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

export function ProfileSection() {
  // Canonical identity — the session user's own roster record (server
  // sync stamps the userId/email link fields; the legacy demo record
  // covers the pre-sync paint). Fields render '—' until it resolves.
  const student = useMyStudentRecord()
  const me = useCurrentUser((s) => s.me)
  const { avatarUrl, upload, remove, uploading, removing } = useAvatarUpload()

  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null)

  const pick = () => fileRef.current?.click()

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!ACCEPTED.split(',').includes(file.type)) {
      setPreview(null)
      import('sonner').then(({ toast }) => toast.error('Please choose a JPG, PNG or WebP image.'))
      return
    }
    if (file.size > MAX_BYTES) {
      setPreview(null)
      import('sonner').then(({ toast }) => toast.error('Photo must be smaller than 5 MB.'))
      return
    }
    setPreview({ url: URL.createObjectURL(file), file })
  }

  const confirmUpload = async () => {
    if (!preview) return
    const ok = await upload(preview.file)
    if (ok) setPreview(null)
  }

  const cancelPreview = () => {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  // B-fix — SERVER-FIRST identity priority (matches the sidebar):
  // me.name / me.student.* are the DB truth; the roster record only
  // fills the gaps while the session resolves.
  const name = me?.name ?? student?.name ?? 'Student'
  const srvStudent = me?.student

  return (
    <SectionCard icon={User} title="Profile" caption="Your photo and official student information">
      {/* ── Your photo ── */}
      <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
        <div className="relative shrink-0 self-start sm:self-center">
          <Avatar
            name={name}
            src={preview ? preview.url : avatarUrl ?? undefined}
            size="xl"
            className={preview ? 'h-20 w-20 text-2xl ring-2 ring-primary/50' : 'h-20 w-20 text-2xl'}
          />
          <button
            onClick={pick}
            disabled={uploading || removing}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {srvStudent?.classLabel
              ? `${srvStudent.classLabel}${srvStudent.rollNo ? ` · Roll ${srvStudent.rollNo}` : ''}`
              : student
                ? `${student.className}-${student.section} · Roll ${student.rollNo}`
                : me?.email}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              aria-label="Choose a profile photo"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" onClick={pick} disabled={uploading || removing}>
              <Upload className="h-3.5 w-3.5" /> {avatarUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {avatarUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { cancelPreview(); remove() }}
                disabled={uploading || removing}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/80 mt-2">JPG, PNG or WebP · up to 5 MB</p>
        </div>
      </div>

      {/* ── Preview / confirm ── */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
              <p className="text-xs font-medium">Previewing a new photo — save to keep it.</p>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm" onClick={cancelPreview} disabled={uploading}>
                  Cancel
                </Button>
                <Button size="sm" onClick={confirmUpload} disabled={uploading}>
                  {uploading ? 'Saving…' : 'Save photo'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Official student information ── */}
      <div className="mt-6 pt-5 border-t border-border/70">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Official student information
          </h4>
          <ManagedBadge />
        </div>
        <div className="divide-y divide-border/60">
          <InfoRow label="Full name" value={me?.name ?? student?.name ?? '—'} managed />
          <InfoRow label="Admission number" value={srvStudent?.admissionNo ?? student?.admissionNo ?? '—'} managed />
          <InfoRow label="Class & section" value={srvStudent?.classLabel ?? (student ? `${student.className} — ${student.section}` : '—')} managed />
          <InfoRow label="Roll number" value={srvStudent?.rollNo ?? student?.rollNo ?? '—'} managed />
          <InfoRow label="Date of birth" value={(srvStudent?.dob ?? student?.dob)?.slice(0, 10) ?? '—'} managed />
          <InfoRow label="House" value={student?.houseName ?? '—'} managed />
          <InfoRow label="Guardian" value={srvStudent?.guardianName ?? student?.guardianName ?? '—'} managed />
        </div>
        <p className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/70" aria-hidden />
          These are official school records. If anything looks wrong, contact your school office —
          they can correct them for you.
        </p>
      </div>

      {/* ── Account (login identity) ── */}
      <div className="mt-6 pt-5 border-t border-border/70">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Account</h4>
        <div className="divide-y divide-border/60">
          <InfoRow label="Sign-in email" value={me?.email ?? '—'} />
          <InfoRow label="Contact phone" value={me?.phone ?? '—'} managed />
        </div>
      </div>
    </SectionCard>
  )
}
