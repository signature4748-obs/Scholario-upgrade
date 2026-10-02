'use client'

/**
 * ContactDetailsSheet — participant details revealed through interaction.
 *
 * Opened by clicking the chat header (name/avatar). Side sheet on desktop,
 * bottom sheet on mobile.
 *
 * Content resolves from canonical data:
 *   staff  → teachers mock (designation, department, subjects, email, phone)
 *   parent → students store (ward, class, guardian phone/email)
 *   group  → linked Group (type, member roster — each member row opens
 *            that person's conversation, or a pre-addressed compose)
 */

import { useMemo } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Mail, Phone, GraduationCap, MapPin, Users, Star, Archive, Settings2,
  Briefcase, BookOpen, RotateCcw, ChevronRight, MessageCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useMessagingStore, resolveMemberRefs, type Conversation,
} from '@/lib/store/messaging-store'
// PHASE 7 (Task 7-a) — staff contact details resolve from the HYDRATED
// teachers-store (real Teacher rows); empty fields render honestly.
import { useTeachersStore } from '@/lib/store/teachers-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { ConversationAvatar } from './shared'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: Conversation | null
  /** Opens the member-management dialog for the linked group. */
  onManageGroup: (groupId: string) => void
  /** Open an existing conversation with this person, else compose to them. */
  onContactMember: (name: string) => void
  onStar: (id: string) => void
  onArchive: (id: string) => void
}

export function ContactDetailsSheet({
  open, onOpenChange, conversation, onManageGroup, onContactMember, onStar, onArchive,
}: Props) {
  const isMobile = useIsMobile()
  const groups = useMessagingStore((s) => s.groups)
  const students = useStudentsStore((s) => s.students)

  const group = useMemo(
    () => (conversation?.type === 'group' ? groups.find((g) => g.conversationId === conversation.id) : undefined),
    [conversation, groups],
  )
  const members = useMemo(
    () => (group ? resolveMemberRefs(group.memberRefs) : []),
    [group],
  )

  // The school's REAL teacher roster (Phase 7 — hydrated from /api/teachers).
  // 8B-7-d — server threads key the counterpart USER id, so the link
  // matches the Teacher row id OR the teacher's user id.
  const teacherRecords = useTeachersStore((s) => s.teachers)
  const teacher = useMemo(
    () => (conversation?.type === 'staff' && (conversation.teacherId || conversation.id)
      ? teacherRecords.find(
          (t) =>
            (conversation.teacherId && t.id === conversation.teacherId) ||
            (t.serverUserId && t.serverUserId === conversation.id),
        )
      : undefined),
    [conversation, teacherRecords],
  )
  const student = useMemo(
    () => (conversation?.type === 'parent' && conversation.studentName
      ? students.find((s) => s.name === conversation!.studentName)
      : undefined),
    [conversation, students],
  )

  if (!conversation) return null
  const convo = conversation

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(
          'flex flex-col gap-0 p-0',
          isMobile
            ? 'max-h-[82dvh] rounded-t-2xl'
            : 'w-full sm:max-w-[20rem] border-l',
        )}
      >
        <SheetHeader className={cn('border-b border-border px-4 py-3.5', isMobile && 'text-center')}>
          <div className={cn('flex items-center gap-3', isMobile && 'flex-col')}>
            <ConversationAvatar avatar={convo.avatar} type={convo.type} size="lg" />
            <div className={cn('min-w-0 flex-1', isMobile && 'shrink-0')}>
              <SheetTitle className="truncate text-[15px] font-semibold leading-tight">
                {convo.name}
              </SheetTitle>
              <SheetDescription className="mt-0.5 truncate text-xs">
                {convo.role}
              </SheetDescription>
            </div>
            {isMobile && (
              <div className="hidden" aria-hidden="true" />
            )}
          </div>

          {convo.type === 'group' && group && (
            <div className={cn('mt-2.5 flex flex-wrap items-center gap-1.5', isMobile && 'justify-center')}>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                <Users className="h-3 w-3" /> {group.type}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {members.length} member{members.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </SheetHeader>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
          {/* Staff details */}
          {convo.type === 'staff' && teacher && (
            <DetailSection>
              <DetailRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Role" value={[teacher.designation, teacher.department].filter(Boolean).join(' · ') || 'Staff'} />
              <DetailRow icon={<BookOpen className="h-3.5 w-3.5" />} label="Subjects" value={teacher.subjects.join(', ') || '—'} />
              <DetailRow icon={<GraduationCap className="h-3.5 w-3.5" />} label="Qualification" value={teacher.professionalQualifications.join(', ') || '—'} />
              {teacher.email && <DetailRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={teacher.email} mono />}
              {teacher.phone && <DetailRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={teacher.phone} mono />}
            </DetailSection>
          )}

          {/* Parent details */}
          {convo.type === 'parent' && (
            <DetailSection>
              {student ? (
                <>
                  <DetailRow icon={<GraduationCap className="h-3.5 w-3.5" />} label="Ward" value={`${student.name} · ${student.className}-${student.section}`} />
                  {student.rollNo && <DetailRow icon={<BookOpen className="h-3.5 w-3.5" />} label="Roll No" value={student.rollNo} mono />}
                  {student.guardianPhone && <DetailRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={student.guardianPhone} mono />}
                  {student.guardianEmail && <DetailRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={student.guardianEmail} mono />}
                  {student.address && <DetailRow icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={student.address} />}
                </>
              ) : (
                <DetailRow icon={<GraduationCap className="h-3.5 w-3.5" />} label="Ward" value={convo.studentName ?? '—'} />
              )}
            </DetailSection>
          )}

          {/* Student details (server direct thread with a student) */}
          {convo.type === 'student' && (
            <DetailSection>
              <DetailRow icon={<GraduationCap className="h-3.5 w-3.5" />} label="Role" value={convo.role || 'Student'} />
              <DetailRow
                icon={<MessageCircle className="h-3.5 w-3.5" />}
                label="Thread"
                value="Direct messages with this student"
              />
            </DetailSection>
          )}

          {/* Group member roster */}
          {convo.type === 'group' && (
            <div className="px-1.5 py-2">
              <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Members
              </p>
              {members.length > 0 ? (
                members.map((m) => (
                  <button
                    key={m.ref}
                    onClick={() => { onOpenChange(false); onContactMember(m.name) }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <ConversationAvatar
                      avatar={m.avatar}
                      type={m.type === 'teacher' ? 'staff' : 'parent'}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{m.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{m.role}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  </button>
                ))
              ) : (
                <p className="px-2.5 py-3 text-[11px] text-muted-foreground">
                  No members in this group yet.
                </p>
              )}
            </div>
          )}

          {/* Archived notice */}
          {convo.archived && (
            <div className="mx-3 mt-2 mb-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              This conversation is archived. History is preserved — restore it to continue messaging.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 border-t border-border p-2.5">
          <div className="flex items-center gap-2">
            {convo.type === 'group' && group && (
              <button
                onClick={() => { onOpenChange(false); onManageGroup(group.id) }}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                <Settings2 className="h-3.5 w-3.5" /> Manage members
              </button>
            )}
            <button
              onClick={() => { onStar(convo.id) }}
              aria-label={convo.starred ? 'Unstar' : 'Star'}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted/50',
                convo.starred ? 'text-amber-500' : 'text-muted-foreground',
              )}
            >
              <Star className={cn('h-4 w-4', convo.starred && 'fill-amber-400 text-amber-400')} />
            </button>
            <button
              onClick={() => { onArchive(convo.id); onOpenChange(false) }}
              aria-label={convo.archived ? 'Restore to Inbox' : 'Archive conversation'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/50 hover:text-rose-500"
            >
              {convo.archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailSection({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border/50 px-4 py-2">{children}</div>
}

function DetailRow({
  icon, label, value, mono,
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground/70">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
        <p className={cn('mt-0.5 break-words text-xs text-foreground/90', mono && 'tabular-nums')}>{value}</p>
      </div>
    </div>
  )
}
