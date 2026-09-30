'use client'

/**
 * SlotCard + MobileSlotCard — timetable assignment cards.
 * Subject prominent, teacher + room with small Lucide icons.
 * × in edit mode removes the assignment (not the structural row).
 */
import { MapPin, UserCheck, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimetableSlot } from './data'
import type { PublishedVersion } from './timetable-store'
import { ChangeIndicator } from './change-indicator'

export function SlotCard({ slot, teacherName, editMode, publications, isConflicted, onEdit, onDuplicate: _onDuplicate, onRemove }: {
  slot: TimetableSlot
  teacherName: string
  editMode: boolean
  publications: PublishedVersion[]
  isConflicted: boolean
  onEdit: () => void
  onDuplicate?: () => void
  onRemove: () => void
}) {
  const isLab = slot.type === 'Lab'
  const isSports = slot.type === 'Sports'

  return (
    <div
      className={cn(
        'group relative rounded-lg border p-2 transition-all',
        editMode ? 'cursor-pointer hover:shadow-sm' : 'cursor-default',
        isLab
          ? 'border-violet-500/20 bg-violet-500/5 hover:border-violet-500/40'
          : isSports
          ? 'border-teal-500/20 bg-teal-500/5 hover:border-teal-500/40'
          : 'border-primary/20 bg-primary/5 hover:border-primary/40',
        isConflicted && 'ring-1 ring-rose-400/40 shadow-[0_0_8px_rgba(244,63,94,0.15)]'
      )}
      onClick={editMode ? onEdit : undefined}
    >
      <ChangeIndicator slotId={slot.id} publications={publications} />
      <div className="flex items-start justify-between gap-1">
        <span className={cn(
          'font-bold text-[11px] truncate',
          isLab ? 'text-violet-700 dark:text-violet-300' : isSports ? 'text-teal-700 dark:text-teal-300' : 'text-primary'
        )}>
          {slot.subject}
        </span>
        {editMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            title="Remove assignment"
            aria-label="Remove assignment"
            className="p-0.5 -mr-0.5 -mt-0.5 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      <p className="text-[10px] font-medium text-foreground mt-1 flex items-center gap-0.5">
        <UserCheck className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        <span className="truncate">{teacherName}</span>
      </p>
      <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
        <MapPin className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        <span className="truncate">{slot.room}</span>
      </p>
    </div>
  )
}

export function MobileSlotCard({ slot, teacherName, publications, isConflicted, editMode, onEdit, onRemove }: {
  slot: TimetableSlot
  teacherName: string
  publications: PublishedVersion[]
  isConflicted: boolean
  editMode: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const isLab = slot.type === 'Lab'
  const isSports = slot.type === 'Sports'

  return (
    <div
      className={cn(
        'relative rounded-lg border p-2.5 transition-all',
        editMode ? 'cursor-pointer active:scale-[0.98]' : '',
        isLab
          ? 'border-violet-500/20 bg-violet-500/5'
          : isSports
          ? 'border-teal-500/20 bg-teal-500/5'
          : 'border-primary/20 bg-primary/5',
        isConflicted && 'ring-1 ring-rose-400/40 shadow-[0_0_8px_rgba(244,63,94,0.15)]'
      )}
      onClick={editMode ? onEdit : undefined}
    >
      <ChangeIndicator slotId={slot.id} publications={publications} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn(
            'text-sm font-bold truncate',
            isLab ? 'text-violet-700 dark:text-violet-300' : isSports ? 'text-teal-700 dark:text-teal-300' : 'text-primary'
          )}>
            {slot.subject}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{slot.className}</p>
        </div>
        {editMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="p-1.5 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
            aria-label="Remove slot"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/30">
        <span className="min-w-0 truncate text-[10px] text-muted-foreground flex items-center gap-0.5">
          <UserCheck className="h-2.5 w-2.5 shrink-0" /> {teacherName}
        </span>
        <span className="min-w-0 truncate text-[10px] text-muted-foreground flex items-center gap-0.5">
          <MapPin className="h-2.5 w-2.5 shrink-0" /> {slot.room}
        </span>
      </div>
    </div>
  )
}
