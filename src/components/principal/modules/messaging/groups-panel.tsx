'use client'

/**
 * GroupsPanel — group management, shown when the Groups folder is active.
 *
 * Calm, scannable rows: avatar · name · type + member count · last
 * activity. Clicking a row opens the group's chat. A single "…" menu
 * per row discloses the actions (Compose · Manage members · Delete)
 * instead of a wall of floating buttons.
 *
 * Create Group dialog: smart auto-fill (class/section/department/staff)
 * plus a searchable manual member picker — unchanged functionality,
 * quieter visuals.
 */

import { useState, useMemo, useEffect } from 'react'
import {
  Plus, Users, Search, Settings2, MessageSquare, Trash2, UserPlus,
  X, GraduationCap, UserCog, Users2, Briefcase, PenSquare,
  Check, MoreHorizontal,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useMessagingStore,
  resolveMemberRefs,
  resolveMemberRef,
  getParentsOfClassSection,
  getTeachersOfClass,
  getTeachersOfDepartment,
  getAllStaffRefs,
  formatListTime,
  GROUP_TYPE_LIST,
  type Group,
  type GroupType,
  type MemberDisplay,
} from '@/lib/store/messaging-store'
import { useStudentsStore } from '@/lib/store/students-store'
// PHASE 7 (Task 7-a) — messaging contacts resolve from the HYDRATED
// teachers-store (real Teacher rows); empty roster ⇒ honest empty pool.
import { useTeachersStore, type TeacherRecord } from '@/lib/store/teachers-store'
import { ACADEMIC_CLASSES } from '@/lib/mock/academic'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/principal/modules/shared/searchable-select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Visual config ────────────────────────────────────────────────────

const TYPE_ICON: Record<GroupType, React.ReactNode> = {
  'Class Group': <GraduationCap className="h-3 w-3" />,
  'Teachers Group': <UserCog className="h-3 w-3" />,
  'Staff Group': <Users2 className="h-3 w-3" />,
  'Department Group': <Briefcase className="h-3 w-3" />,
  'Parents Group': <Users className="h-3 w-3" />,
  'Custom Group': <PenSquare className="h-3 w-3" />,
}

const TYPE_PILL: Record<GroupType, string> = {
  'Class Group': 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'Teachers Group': 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  'Staff Group': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'Department Group': 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'Parents Group': 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'Custom Group': 'bg-muted text-muted-foreground',
}

function avatarFromName(name: string): string {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'G'
}

// ─── Member pool (teachers + parents from canonical data) ─────────────

interface PoolMember {
  ref: string
  name: string
  avatar: string
  role: string
  type: 'teacher' | 'parent'
}

function getMemberPool(teachers: TeacherRecord[]): PoolMember[] {
  const students = useStudentsStore.getState().students
  const activeStudents = students.filter((s) => s.status === 'Active')

  const teachersPool: PoolMember[] = teachers
    .map((t) => ({
      ref: `t:${t.id}`,
      name: t.name,
      avatar: t.avatar,
      role: [t.designation || 'Teacher', t.department].filter(Boolean).join(' · '),
      type: 'teacher' as const,
    }))

  const parentsPool: PoolMember[] = activeStudents.map((s) => ({
    ref: `p:${s.id}`,
    name: s.fatherName,
    avatar: s.fatherName.split(' ').map((n) => n[0]).slice(0, 2).join(''),
    role: `Parent · ${s.name} (${s.className}-${s.section})`,
    type: 'parent' as const,
  }))

  return [...teachersPool, ...parentsPool]
}

// ─── Props ────────────────────────────────────────────────────────────

interface Props {
  onCompose: (recipientName?: string) => void
}

// ─── GroupsPanel ──────────────────────────────────────────────────────

export function GroupsPanel({ onCompose }: Props) {
  const groups = useMessagingStore((s) => s.groups)
  const conversations = useMessagingStore((s) => s.conversations)
  const openConversation = useMessagingStore((s) => s.openConversation)
  const searchQuery = useMessagingStore((s) => s.searchQuery)
  const setSearchQuery = useMessagingStore((s) => s.setSearchQuery)
  const activeConversationId = useMessagingStore((s) => s.activeConversationId)
  const deleteGroup = useMessagingStore((s) => s.deleteGroup)

  const [createOpen, setCreateOpen] = useState(false)
  const [manageGroupId, setManageGroupId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.type.toLowerCase().includes(q),
    )
  }, [groups, searchQuery])

  const handleDelete = (g: Group) => {
    deleteGroup(g.id)
    toast.success('Group deleted', { description: g.name })
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      {/* Header — search + Create Group */}
      <div className="shrink-0 space-y-2.5 border-b border-border px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-[13px] font-semibold text-foreground">Groups</h2>
          <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {groups.length}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-7.5 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New group</span>
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search groups…"
            aria-label="Search groups"
            className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Groups list */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {filtered.length > 0 ? (
          filtered.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              isActive={activeConversationId === g.conversationId}
              lastActivity={
                conversations.find((c) => c.id === g.conversationId)
                  ? formatListTime(conversations.find((c) => c.id === g.conversationId)!.lastTimestamp)
                  : '—'
              }
              onOpenChat={() => openConversation(g.conversationId)}
              onManage={() => setManageGroupId(g.id)}
              onCompose={() => onCompose(g.name)}
              onDelete={() => handleDelete(g)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-2.5 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground/50">
              <Users className="h-6 w-6" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              {searchQuery ? 'No groups match your search' : 'No groups yet'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {searchQuery ? 'Try a different search term.' : 'Create a group to message many people at once.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setCreateOpen(true)}
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> Create Group
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ManageMembersDialog
        groupId={manageGroupId}
        onOpenChange={(open) => { if (!open) setManageGroupId(null) }}
      />
    </div>
  )
}

// ─── GroupRow ─────────────────────────────────────────────────────────

function GroupRow({
  group, isActive, lastActivity, onOpenChat, onManage, onCompose, onDelete,
}: {
  group: Group
  isActive: boolean
  lastActivity: string
  onOpenChat: () => void
  onManage: () => void
  onCompose: () => void
  onDelete: () => void
}) {
  const memberCount = group.memberRefs.length
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenChat}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChat() } }}
      className={cn(
        'group relative cursor-pointer border-b border-border/40 px-3 py-2.5 outline-none transition-colors',
        'focus-visible:bg-muted/40',
        isActive ? 'bg-primary/[0.07]' : 'hover:bg-muted/40',
      )}
    >
      {isActive && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-primary" aria-hidden="true" />}

      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600/90 text-[11px] font-semibold text-white">
          {avatarFromName(group.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-medium text-foreground/85">{group.name}</p>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/80 group-hover:hidden">
              {lastActivity}
            </span>
            {/* Single action menu (disclosed on hover / always on touch) */}
            <div className="hidden shrink-0 group-hover:block max-md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Actions for ${group.name}`}
                    className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={onOpenChat}>
                    <MessageSquare className="h-3.5 w-3.5" /> Open chat
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onManage}>
                    <Settings2 className="h-3.5 w-3.5" /> Manage members
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onCompose}>
                    <PenSquare className="h-3.5 w-3.5" /> Compose to group
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={onDelete}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete group
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
              TYPE_PILL[group.type],
            )}>
              {TYPE_ICON[group.type]}
              {group.type.replace(' Group', '')}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground">
              <Users className="h-2.5 w-2.5" />
              {memberCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── CreateGroupDialog ────────────────────────────────────────────────

function CreateGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createGroup = useMessagingStore((s) => s.createGroup)
  const [name, setName] = useState('')
  const [type, setType] = useState<GroupType>('Class Group')
  const [className, setClassName] = useState<string>('')
  const [section, setSection] = useState<string>('')
  const [department, setDepartment] = useState<string>('')
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [memberSearch, setMemberSearch] = useState('')

  // The school's REAL teacher roster (Phase 7 — hydrated from /api/teachers).
  const teachers = useTeachersStore((s) => s.teachers)
  const pool = useMemo(() => getMemberPool(teachers), [teachers])

  const classOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: { id: string; label: string }[] = []
    for (const c of ACADEMIC_CLASSES) {
      if (!seen.has(c.name)) {
        seen.add(c.name)
        out.push({ id: c.name, label: c.name })
      }
    }
    return out
  }, [])
  const sectionOptions = useMemo(() => {
    const cls = ACADEMIC_CLASSES.find((c) => c.name === className)
    return (cls?.sections ?? []).map((s) => ({ id: s, label: s }))
  }, [className])
  const departmentOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: { id: string; label: string }[] = []
    for (const t of teachers) {
      if (!t.department || seen.has(t.department)) continue
      seen.add(t.department)
      out.push({ id: t.department, label: t.department })
    }
    return out
  }, [teachers])

  // Smart auto-fill: when the user picks a class+section / class / department,
  // pre-fill the suggested members and a suggested name.
  const smartFill = useMemo(() => {
    if (type === 'Class Group' || type === 'Parents Group') {
      if (!className || !section) return null
      const refs = getParentsOfClassSection(className, section)
      const suggestedName = `${className}-${section} Parents`
      return { refs, suggestedName }
    }
    if (type === 'Teachers Group') {
      if (!className) return null
      const cls = ACADEMIC_CLASSES.find((c) => c.name === className)
      const sections = cls?.sections ?? ['A']
      const refs = Array.from(new Set(sections.flatMap((s) => getTeachersOfClass(`${className}-${s}`))))
      const suggestedName = `${className} Teachers`
      return { refs, suggestedName }
    }
    if (type === 'Department Group') {
      if (!department) return null
      const refs = getTeachersOfDepartment(department)
      const suggestedName = `${department} Department`
      return { refs, suggestedName }
    }
    if (type === 'Staff Group') {
      const refs = getAllStaffRefs()
      const suggestedName = 'All Staff'
      return { refs, suggestedName }
    }
    return null
  }, [type, className, section, department])

  useEffect(() => {
    if (open) {
      setName('')
      setType('Class Group')
      setClassName('')
      setSection('')
      setDepartment('')
      setSelectedRefs([])
      setMemberSearch('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (smartFill) {
      setName((prev) => prev || smartFill.suggestedName)
      setSelectedRefs((prev) => Array.from(new Set([...prev, ...smartFill.refs])))
    }
  }, [smartFill, open])

  const filteredPool = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return pool
    return pool.filter((p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
  }, [pool, memberSearch])

  const selectedSet = useMemo(() => new Set(selectedRefs), [selectedRefs])
  const selectedMembers = useMemo(
    () => selectedRefs.map(resolveMemberRef).filter((x): x is MemberDisplay => x !== null),
    [selectedRefs],
  )

  const canSubmit = name.trim().length > 0 && selectedRefs.length > 0

  const toggleMember = (ref: string) => {
    setSelectedRefs((prev) => prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref])
  }

  const handleSubmit = () => {
    if (!canSubmit) {
      if (!name.trim()) toast.error('Group name is required')
      else if (selectedRefs.length === 0) toast.error('Add at least one member')
      return
    }
    createGroup({ name: name.trim(), type, memberRefs: selectedRefs })
    toast.success('Group created', {
      description: `${name.trim()} · ${selectedRefs.length} member${selectedRefs.length === 1 ? '' : 's'}`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-violet-600" />
            Create Group
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pick a type to auto-fill members, or choose them manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Group name */}
          <div className="space-y-1">
            <Label className="text-[11px]">Group Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Class 10-A Parents, Sports Committee…"
              className="h-9 text-sm"
            />
          </div>

          {/* Group type */}
          <div className="space-y-1">
            <Label className="text-[11px]">Group Type</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {GROUP_TYPE_LIST.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setType(t); setSelectedRefs([]); setName('') }}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors',
                    type === t
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {TYPE_ICON[t]}
                  <span className="truncate">{t.replace(' Group', '')}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Smart picker — varies by type */}
          {(type === 'Class Group' || type === 'Parents Group') && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Class</Label>
                <SearchableSelect
                  selectedId={className}
                  onSelect={setClassName}
                  placeholder="Pick a class"
                  options={classOptions}
                  pickerId="grp-class"
                  popoverWidth="w-56"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Section</Label>
                <SearchableSelect
                  selectedId={section}
                  onSelect={setSection}
                  placeholder="Pick a section"
                  options={sectionOptions}
                  pickerId="grp-section"
                  popoverWidth="w-40"
                />
              </div>
            </div>
          )}

          {type === 'Teachers Group' && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Class</Label>
              <SearchableSelect
                selectedId={className}
                onSelect={setClassName}
                placeholder="Pick a class (teachers across all sections)"
                options={classOptions}
                pickerId="grp-tch-class"
                popoverWidth="w-56"
              />
            </div>
          )}

          {type === 'Department Group' && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Department</Label>
              <SearchableSelect
                selectedId={department}
                onSelect={setDepartment}
                placeholder="Pick a department"
                options={departmentOptions}
                pickerId="grp-dept"
                popoverWidth="w-56"
              />
            </div>
          )}

          {type === 'Staff Group' && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[11px] text-muted-foreground dark:bg-amber-500/[0.06]">
              <span className="font-semibold text-amber-700 dark:text-amber-300">All Staff:</span>{' '}
              All active teachers will be added — untick anyone you want to exclude.
            </div>
          )}

          {type === 'Custom Group' && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Custom group — pick members manually below.
            </div>
          )}

          {/* Smart-fill hint */}
          {smartFill && smartFill.refs.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 text-[11px] text-muted-foreground dark:bg-emerald-500/[0.06]">
              <span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Auto-filled:</span>{' '}
                {smartFill.refs.length} member{smartFill.refs.length === 1 ? '' : 's'} from{' '}
                {type === 'Class Group' || type === 'Parents Group' ? `${className}-${section}` :
                  type === 'Teachers Group' ? className :
                  type === 'Department Group' ? department :
                  'all staff'}.
              </span>
              <button
                type="button"
                onClick={() => { setSelectedRefs([]); setName('') }}
                className="shrink-0 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}

          {/* Selected members */}
          <div className="space-y-1">
            <Label className="flex items-center justify-between text-[11px]">
              <span>Members ({selectedRefs.length})</span>
              {selectedRefs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedRefs([])}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </Label>
            {selectedMembers.length > 0 ? (
              <div className="custom-scrollbar flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
                {selectedMembers.map((m) => (
                  <span
                    key={m.ref}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-1.5 pr-1 text-[10px]"
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-bold text-white',
                        m.type === 'teacher'
                          ? 'bg-emerald-600/90'
                          : 'bg-amber-500/90',
                      )}
                    >
                      {m.avatar}
                    </span>
                    <span className="font-medium">{m.name}</span>
                    <button
                      type="button"
                      onClick={() => toggleMember(m.ref)}
                      className="text-muted-foreground hover:text-rose-500"
                      aria-label={`Remove ${m.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">No members selected yet.</p>
            )}
          </div>

          {/* Member picker — search + checkbox list */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1.5 text-[11px]">
              <UserPlus className="h-3 w-3" /> Add Members
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search teachers or parents…"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <div className="custom-scrollbar max-h-44 divide-y divide-border/30 overflow-y-auto rounded-md border border-border">
              {filteredPool.slice(0, 60).map((p) => {
                const selected = selectedSet.has(p.ref)
                return (
                  <button
                    key={p.ref}
                    type="button"
                    onClick={() => toggleMember(p.ref)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                      selected ? 'bg-emerald-500/[0.06] dark:bg-emerald-500/[0.08]' : 'hover:bg-muted/40',
                    )}
                  >
                    <div className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                      selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border',
                    )}>
                      {selected && <Check className="h-2.5 w-2.5" />}
                    </div>
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white',
                        p.type === 'teacher' ? 'bg-emerald-600/90' : 'bg-amber-500/90',
                      )}
                    >
                      {p.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium">{p.name}</p>
                      <p className="truncate text-[9px] text-muted-foreground">{p.role}</p>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold',
                      p.type === 'teacher'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                    )}>
                      {p.type === 'teacher' ? 'Staff' : 'Parent'}
                    </span>
                  </button>
                )
              })}
              {filteredPool.length === 0 && (
                <p className="px-3 py-4 text-center text-[10px] text-muted-foreground">No matches.</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" /> Create Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ManageMembersDialog ──────────────────────────────────────────────

export function ManageMembersDialog({
  groupId, onOpenChange,
}: {
  groupId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const addMember = useMessagingStore((s) => s.addMember)
  const removeMember = useMessagingStore((s) => s.removeMember)
  const groups = useMessagingStore((s) => s.groups)
  const [addRef, setAddRef] = useState('')

  // Always read the latest group state from the store so member add/remove
  // updates show without remounting.
  const liveGroup = groupId ? groups.find((g) => g.id === groupId) : null
  const members = useMemo(
    () => (liveGroup ? resolveMemberRefs(liveGroup.memberRefs) : []),
    [liveGroup],
  )

  // The school's REAL teacher roster (Phase 7 — hydrated from /api/teachers).
  const teachers = useTeachersStore((s) => s.teachers)
  const pool = useMemo(() => getMemberPool(teachers), [teachers])
  const memberSet = useMemo(() => new Set(liveGroup?.memberRefs ?? []), [liveGroup])
  const addable = useMemo(
    () => pool
      .filter((p) => !memberSet.has(p.ref))
      .map((p) => ({ id: p.ref, label: p.name, avatar: p.avatar, meta: p.role })),
    [pool, memberSet],
  )

  useEffect(() => {
    setAddRef('')
  }, [groupId])

  const handleAdd = () => {
    if (!liveGroup || !addRef) return
    const result = addMember(liveGroup.id, addRef)
    if (!result.success) {
      toast.error(result.error || 'Could not add member')
      return
    }
    const display = resolveMemberRef(addRef)
    toast.success('Member added', {
      description: display ? `${display.name} added to ${liveGroup.name}` : 'Member added',
    })
    setAddRef('')
  }

  const handleRemove = (ref: string) => {
    if (!liveGroup) return
    const display = resolveMemberRef(ref)
    removeMember(liveGroup.id, ref)
    toast.success('Member removed', {
      description: display ? `${display.name} removed from ${liveGroup.name}` : 'Member removed',
    })
  }

  if (!groupId) return null

  return (
    <Dialog open={!!groupId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600/90 text-[10px] font-semibold text-white">
              {liveGroup ? avatarFromName(liveGroup.name) : 'G'}
            </div>
            {liveGroup?.name ?? 'Group'}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-xs">
            {liveGroup && (
              <>
                <span className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                  TYPE_PILL[liveGroup.type],
                )}>
                  {TYPE_ICON[liveGroup.type]}
                  {liveGroup.type}
                </span>
                <span className="inline-flex items-center gap-0.5 tabular-nums text-[10px] text-muted-foreground">
                  <Users className="h-2.5 w-2.5" />
                  {members.length} member{members.length === 1 ? '' : 's'}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Add member */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1.5 text-[11px]">
              <UserPlus className="h-3 w-3" /> Add a Member
            </Label>
            <div className="flex items-end gap-1.5">
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  selectedId={addRef}
                  onSelect={setAddRef}
                  placeholder="Search teachers or parents…"
                  options={addable}
                  pickerId="grp-add-member"
                  popoverWidth="w-64"
                />
              </div>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!addRef}
                className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {addable.length === 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Everyone is already a member of this group.
              </p>
            )}
          </div>

          {/* Current members */}
          <div className="space-y-1">
            <Label className="text-[11px]">Current Members ({members.length})</Label>
            <div className="custom-scrollbar max-h-64 divide-y divide-border/30 overflow-y-auto rounded-md border border-border">
              {members.length > 0 ? (
                members.map((m) => (
                  <div key={m.ref} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30">
                    <div
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white',
                        m.type === 'teacher' ? 'bg-emerald-600/90' : 'bg-amber-500/90',
                      )}
                    >
                      {m.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium">{m.name}</p>
                      <p className="truncate text-[9px] text-muted-foreground">{m.role}</p>
                    </div>
                    <button
                      onClick={() => handleRemove(m.ref)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-500"
                      title="Remove from group"
                      aria-label={`Remove ${m.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-[10px] text-muted-foreground">
                  No members yet — add some above.
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
