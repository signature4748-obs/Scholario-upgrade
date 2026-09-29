'use client'

import { useState, useMemo } from 'react'
import { ArrowLeft, Plus, X, Search } from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { toast } from 'sonner'
import { RoomSelect } from './room-select'

interface SectionEntry {
  name: string
  capacity: number
  room: string
}

export function AddClassPage({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const teachersStore = useTeachersStore()
  const allTeachers = teachersStore.teachers
  const createClass = useStudentsStore((s) => s.createClass)

  const [form, setForm] = useState({
    name: '', academicYear: '2025-2026', medium: 'English',
    room: '', capacity: 40,
  })
  const [sections, setSections] = useState<SectionEntry[]>([
    { name: 'A', capacity: 40, room: '' },
  ])
  const [classTeacherId, setClassTeacherId] = useState('')
  const [assistantTeacherId, setAssistantTeacherId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [teacherSearch, setTeacherSearch] = useState('')
  const [showTeacherList, setShowTeacherList] = useState<'class' | 'assistant' | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const setF = (k: string, v: any) => { setForm((p) => ({ ...p, [k]: v })); setErrors((p) => ({ ...p, [k]: '' })) }

  const addSection = () => setSections((p) => [...p, { name: '', capacity: 40, room: '' }])
  const removeSection = (i: number) => setSections((p) => p.filter((_, idx) => idx !== i))
  const updateSection = (i: number, k: keyof SectionEntry, v: any) => {
    setSections((p) => p.map((s, idx) => idx === i ? { ...s, [k]: v } : s))
  }

  // Find teachers already assigned as class teacher elsewhere
  const assignedClassTeacherIds = useMemo(() => {
    const set = new Set<string>()
    // Check existing classes for class teacher assignments
    // (Teachers who are already class teachers are "assigned")
    allTeachers.forEach((t) => {
      if (t.status === 'Active' && t.positions?.some((p) => p.status === 'Active' && p.positionTitle?.includes('Class Teacher'))) {
        const match = t.positions.find((p) => p.positionTitle?.includes('Class Teacher'))
        if (match) set.add(t.id)
      }
    })
    return set
  }, [allTeachers])

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.toLowerCase()
    return allTeachers.filter((t) =>
      t.status === 'Active' &&
      (t.name.toLowerCase().includes(q) || t.employeeId.toLowerCase().includes(q) || (t.department || '').toLowerCase().includes(q))
    )
  }, [allTeachers, teacherSearch])

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Class name is required'
    if (!form.academicYear.trim()) errs.academicYear = 'Academic year is required'
    if (sections.length === 0) errs.sections = 'At least one section is required'
    const sectionNames = sections.map((s) => s.name.trim()).filter(Boolean)
    if (sectionNames.length !== new Set(sectionNames).size) errs.sections = 'Duplicate section names'
    sections.forEach((s, i) => {
      if (!s.name.trim()) errs[`section-${i}-name`] = 'Section name required'
      if (s.capacity <= 0) errs[`section-${i}-capacity`] = 'Invalid capacity'
    })
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleCreate = () => {
    if (!validate()) { toast.error('Please fix the errors before creating.'); return }
    // REAL creation — persists to the students store (tenant-scoped), so
    // the class appears in Students & Classes, pickers and exports.
    const record = createClass({
      name: form.name,
      sections: sections.map((s) => ({
        name: s.name,
        capacity: s.capacity,
        room: s.room || form.room,
      })),
      capacity: form.capacity,
      room: form.room,
      classTeacherId: classTeacherId || undefined,
      assistantTeacherId: assistantTeacherId || undefined,
    })
    toast.success(`Class ${record.name} created`, {
      description: `${record.sections.length} section${record.sections.length > 1 ? 's' : ''} · ${record.level}`,
    })
    onCreated()
  }

  const selectTeacher = (teacherId: string, role: 'class' | 'assistant') => {
    if (assignedClassTeacherIds.has(teacherId) && role === 'class') {
      toast.error('This teacher is already assigned as a Class Teacher elsewhere.')
      return
    }
    if (role === 'class') setClassTeacherId(teacherId)
    else setAssistantTeacherId(teacherId)
    setShowTeacherList(null); setTeacherSearch('')
  }

  const selectedClassTeacher = allTeachers.find((t) => t.id === classTeacherId)
  const selectedAssistantTeacher = allTeachers.find((t) => t.id === assistantTeacherId)

  return (
    <PageTransition>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Add New Class</h1>
            <p className="text-xs text-muted-foreground">Create a new class with sections, capacity and teacher assignments.</p>
          </div>
        </div>

        {/* CLASS INFORMATION */}
        <div>
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Class Information</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-semibold">Class Name</Label>
              <Input value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="e.g. Class 6" className={cn('mt-1.5 h-9', errors.name && 'border-rose-500/50')} />
              {errors.name && <p className="text-[10px] text-rose-600 mt-1">{errors.name}</p>}
            </div>
            <div>
              <Label className="text-xs font-semibold">Academic Year</Label>
              <Input value={form.academicYear} onChange={(e) => setF('academicYear', e.target.value)} placeholder="2025-2026" className={cn('mt-1.5 h-9', errors.academicYear && 'border-rose-500/50')} />
              {errors.academicYear && <p className="text-[10px] text-rose-600 mt-1">{errors.academicYear}</p>}
            </div>
            <div>
              <Label className="text-xs font-semibold">Medium</Label>
              <Select value={form.medium} onValueChange={(v) => setF('medium', v)}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="English">English</SelectItem><SelectItem value="Hindi">Hindi</SelectItem><SelectItem value="Bilingual">Bilingual</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Room <span className="text-muted-foreground font-normal">(default for sections)</span></Label>
              <div className="mt-1.5">
                <RoomSelect value={form.room} onChange={(v) => setF('room', v)} placeholder="Choose a room…" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold">Seats / Section</Label>
              <Input type="number" min={1} value={form.capacity} onChange={(e) => setF('capacity', parseInt(e.target.value) || 0)} placeholder="40" className="mt-1.5 h-9" />
            </div>
          </div>
        </div>

        {/* SECTIONS */}
        <div className="pt-4 border-t border-border">
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Sections</p>
          {errors.sections && <p className="text-[10px] text-rose-600 mb-2">{errors.sections}</p>}
          <div className="space-y-3">
            {sections.map((sec, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs font-semibold">Section Name</Label>
                  <Input value={sec.name} onChange={(e) => updateSection(i, 'name', e.target.value)} placeholder="e.g. A" className={cn('mt-1.5 h-9', errors[`section-${i}-name`] && 'border-rose-500/50')} />
                </div>
                <div className="w-24">
                  <Label className="text-xs font-semibold">Capacity</Label>
                  <Input type="number" value={sec.capacity} onChange={(e) => updateSection(i, 'capacity', parseInt(e.target.value) || 0)} placeholder="40" className={cn('mt-1.5 h-9', errors[`section-${i}-capacity`] && 'border-rose-500/50')} />
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-semibold">Room</Label>
                  <div className="mt-1.5">
                    <RoomSelect value={sec.room || form.room} onChange={(v) => updateSection(i, 'room', v)} />
                  </div>
                </div>
                {sections.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeSection(i)} className="h-9 px-2 text-rose-600 hover:text-rose-700">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={addSection} className="mt-2 text-xs gap-1.5 h-8">
            <Plus className="h-3.5 w-3.5" /> Add Section
          </Button>
        </div>

        {/* TEACHER ASSIGNMENTS */}
        <div className="pt-4 border-t border-border">
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Teacher Assignments</p>
          <div className="space-y-4">
            {/* Class Teacher */}
            <div>
              <Label className="text-xs font-semibold">Class Teacher</Label>
              <div className="mt-1.5">
                {selectedClassTeacher ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 text-xs font-semibold">{selectedClassTeacher.avatar}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{selectedClassTeacher.name}</p>
                        <p className="text-[10px] text-muted-foreground">{selectedClassTeacher.employeeId} · {selectedClassTeacher.department}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setClassTeacherId('')} className="h-7 px-2 text-rose-600"><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={showTeacherList === 'class' ? teacherSearch : ''}
                      onChange={(e) => { setShowTeacherList('class'); setTeacherSearch(e.target.value) }}
                      onFocus={() => setShowTeacherList('class')}
                      placeholder="Search and select teacher…"
                      className="pl-9 h-9"
                    />
                    {showTeacherList === 'class' && (
                      <div className="absolute top-full mt-1 w-full rounded-lg border border-border bg-popover shadow-lg z-10 max-h-60 overflow-y-auto divide-y divide-border/40">
                        {filteredTeachers.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No teachers found.</p>
                        ) : filteredTeachers.slice(0, 20).map((t) => {
                          const isAssigned = assignedClassTeacherIds.has(t.id)
                          return (
                            <button
                              key={t.id}
                              type="button"
                              disabled={isAssigned}
                              onClick={() => selectTeacher(t.id, 'class')}
                              className={cn('w-full px-3 py-2 flex items-center gap-2 text-left transition-colors',
                                isAssigned ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/40 cursor-pointer')}
                            >
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-semibold">{t.avatar}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                                <p className="text-[10px] text-muted-foreground">{t.employeeId} · {t.department}</p>
                              </div>
                              {isAssigned && <Badge variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-700">Assigned</Badge>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Assistant Class Teacher */}
            <div>
              <Label className="text-xs font-semibold">Assistant Class Teacher</Label>
              <div className="mt-1.5">
                {selectedAssistantTeacher ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 text-xs font-semibold">{selectedAssistantTeacher.avatar}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{selectedAssistantTeacher.name}</p>
                        <p className="text-[10px] text-muted-foreground">{selectedAssistantTeacher.employeeId} · {selectedAssistantTeacher.department}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setAssistantTeacherId('')} className="h-7 px-2 text-rose-600"><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={showTeacherList === 'assistant' ? teacherSearch : ''}
                      onChange={(e) => { setShowTeacherList('assistant'); setTeacherSearch(e.target.value) }}
                      onFocus={() => setShowTeacherList('assistant')}
                      placeholder="Search and select teacher…"
                      className="pl-9 h-9"
                    />
                    {showTeacherList === 'assistant' && (
                      <div className="absolute top-full mt-1 w-full rounded-lg border border-border bg-popover shadow-lg z-10 max-h-60 overflow-y-auto divide-y divide-border/40">
                        {filteredTeachers.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No teachers found.</p>
                        ) : filteredTeachers.slice(0, 20).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTeacher(t.id, 'assistant')}
                            className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40 cursor-pointer transition-colors"
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-semibold">{t.avatar}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                              <p className="text-[10px] text-muted-foreground">{t.employeeId} · {t.department}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* REMARKS */}
        <div className="pt-4 border-t border-border">
          <Label className="text-xs font-semibold">Remarks</Label>
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional notes about this class…" className="mt-1.5 h-9" />
        </div>

        {/* STICKY FOOTER */}
        <div className="sticky bottom-0 left-0 right-0 z-30 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t border-border/60 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onBack} className="h-8 text-xs">Cancel</Button>
          <Button onClick={handleCreate} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Create Class</Button>
        </div>
      </div>
    </PageTransition>
  )
}
