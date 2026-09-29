'use client'

/**
 * ScheduleTable — Spec §4 / §5 / §6 / §7 / §19 / §20 / §21.
 *
 * Renders the examination timetable as a class-column table:
 *
 *   DAY / DATE | CLASS 6 | CLASS 8 | CLASS 11 PCM | ...
 *   ────────────────────────────────────────────────────────
 *   Wed        | Hindi    | English  | Physics      | ...
 *   19 Aug     | Science  | Maths    | Hindi        | ...
 *   ────────────────────────────────────────────────────────
 *   Thu        | Maths    | Hindi    | Chemistry    | ...
 *   20 Aug     | English  | Science  | English      | ...
 *
 * Features:
 *   - Sticky first column (Day/Date) + sticky header row.
 *   - Horizontal scroll when many classes are selected.
 *   - Row-span on the date cell so both slots for a day visually group.
 *   - Drag-and-drop reorder within a class column (HTML5 DnD — no new deps).
 *   - Slot label / time range shown per row.
 *   - "Too short" warning when the window can't fit all subjects (Spec §25).
 */

import { useMemo, useState } from 'react'
import { Clock, AlertTriangle, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScheduleTimetable, ScheduleRow, ScheduleCell } from '@/lib/exams/schedule/schedule-types'
import type { CellLocation } from '@/lib/exams/schedule/schedule-reorder'
import { formatDateLong } from '@/lib/exams/format-helpers'

interface Props {
  timetable: ScheduleTimetable
  onMoveSubject: (src: CellLocation, dst: CellLocation) => void
}

/** Group rows by date so the date cell can row-span across its slots. */
function groupRowsByDate(rows: ScheduleRow[]): Array<{ date: string; dayLabel: string; rows: ScheduleRow[] }> {
  const groups: Array<{ date: string; dayLabel: string; rows: ScheduleRow[] }> = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.date === row.date) {
      last.rows.push(row)
    } else {
      groups.push({ date: row.date, dayLabel: row.dayLabel, rows: [row] })
    }
  }
  return groups
}

export function ScheduleTable({ timetable, onMoveSubject }: Props) {
  const [dragSrc, setDragSrc] = useState<CellLocation | null>(null)
  const [hoverDst, setHoverDst] = useState<CellLocation | null>(null)

  const dateGroups = useMemo(() => groupRowsByDate(timetable.rows), [timetable.rows])

  const handleDragStart = (rowIdx: number, classIdx: number, cell: ScheduleCell | null) => (e: React.DragEvent) => {
    if (!cell) { e.preventDefault(); return }
    setDragSrc({ rowIdx, classIdx })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${rowIdx}:${classIdx}`)
  }
  const handleDragOver = (rowIdx: number, classIdx: number) => (e: React.DragEvent) => {
    if (!dragSrc) return
    // Only allow drops in the SAME class column (Spec §15).
    if (classIdx !== dragSrc.classIdx) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setHoverDst({ rowIdx, classIdx })
  }
  const handleDrop = (rowIdx: number, classIdx: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragSrc) return
    if (classIdx !== dragSrc.classIdx) return
    if (dragSrc.rowIdx !== rowIdx) {
      onMoveSubject(dragSrc, { rowIdx, classIdx })
    }
    setDragSrc(null)
    setHoverDst(null)
  }
  const _handleDragEnd = () => { setDragSrc(null); setHoverDst(null) }

  return (
    <div className="space-y-2">
      {timetable.rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          No working days in the selected window. Adjust the date range.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="w-full border-collapse text-xs">
              {/* Header row — sticky */}
              <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted px-2.5 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground border-b border-r border-border/60 min-w-[88px]">
                    Day / Date
                  </th>
                  {timetable.classes.map((cls) => (
                    <th key={cls.id} className="px-2.5 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60 min-w-[110px]">
                      {cls.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dateGroups.map((group) => (
                  group.rows.map((row, slotWithinGroup) => {
                    const globalRowIdx = timetable.rows.indexOf(row)
                    return (
                      <tr key={`${row.date}-${row.slotIndex}`} className="group">
                        {/* Day/Date cell — spans all slots for this date */}
                        {slotWithinGroup === 0 && (
                          <td
                            rowSpan={group.rows.length}
                            className="sticky left-0 z-[1] bg-card px-2.5 py-2 align-top border-b border-r border-border/60"
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-medium text-muted-foreground">{row.dayLabel}</span>
                              <span className="text-xs font-semibold text-foreground tabular-nums">{formatDateLong(row.date)}</span>
                            </div>
                          </td>
                        )}
                        {/* Slot label column-less — we fold it into each cell's top */}
                        {row.cells.map((cell, classIdx) => (
                          <td
                            key={`${globalRowIdx}-${classIdx}`}
                            className={cn(
                              'border-b border-r border-border/40 px-1.5 py-1 align-top',
                              hoverDst?.rowIdx === globalRowIdx && hoverDst?.classIdx === classIdx && 'bg-primary/5',
                            )}
                          >
                            <ScheduleCellView
                              cell={cell}
                              slotLabel={row.slotLabel}
                              time={`${row.startTime}–${row.endTime}`}
                              isDragSource={dragSrc?.rowIdx === globalRowIdx && dragSrc?.classIdx === classIdx}
                              onDragStart={handleDragStart(globalRowIdx, classIdx, cell)}
                              onDragOver={handleDragOver(globalRowIdx, classIdx)}
                              onDrop={handleDrop(globalRowIdx, classIdx)}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer hints */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{timetable.rows.length} slot{timetable.rows.length === 1 ? '' : 's'} · Sundays skipped</span>
        </div>
        {!timetable.fits && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-1 rounded">
            <AlertTriangle className="h-3 w-3" />
            <span>Schedule window is too short — need ~{timetable.additionalDaysNeeded} more day{timetable.additionalDaysNeeded === 1 ? '' : 's'}.</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** One cell in the timetable grid. */
function ScheduleCellView({
  cell,
  slotLabel,
  time: _time,
  isDragSource,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  cell: ScheduleCell | null
  slotLabel: string
  time: string
  isDragSource: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}) {
  if (!cell) {
    return (
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="min-h-[2.75rem] rounded border border-dashed border-transparent hover:border-border/60 transition-colors"
      >
        <span className="sr-only">Empty slot</span>
      </div>
    )
  }
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'group/cell relative min-h-[2.75rem] rounded border px-1.5 py-1 cursor-grab active:cursor-grabbing transition-all',
        'bg-card border-border/60 hover:border-primary/40 hover:shadow-sm',
        isDragSource && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-0.5 group-hover/cell:text-muted-foreground/70" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground truncate">{cell.subjectName}</p>
          <span className="text-[8px] font-mono text-muted-foreground/70">{cell.subjectCode}</span>
        </div>
      </div>
      <span className="sr-only">{slotLabel}</span>
    </div>
  )
}
