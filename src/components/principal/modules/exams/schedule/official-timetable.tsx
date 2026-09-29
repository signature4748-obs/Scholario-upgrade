'use client'

/**
 * OfficialTimetable — Step 2 preview (Spec §9 / §10 / §11).
 *
 * Renders the consolidated examination timetable as an official school
 * document. No drag/drop — read-only presentation suitable for print/export.
 *
 * Header hierarchy (Spec §1 — centered):
 *   SCHOOL NAME
 *   EXAMINATION NAME
 *   Academic Session · Type
 *   Date Range · Time · Papers
 *   EXAMINATION TIMETABLE
 *
 * Table (Spec §2 — compact official scale):
 *   DAY / DATE | CLASS 6 | CLASS 8 | ... | CLASS 11 | CLASS 12
 *   with consolidated cells ("Maths / Biology" where streams differ).
 */

import { useMemo } from 'react'
import { GraduationCap, CalendarDays } from 'lucide-react'
import type { ConsolidatedTimetable } from '@/lib/exams/schedule/consolidate'
import type { ScheduleRow } from '@/lib/exams/schedule/schedule-types'
import { formatDateLong } from '@/lib/exams/format-helpers'

export interface OfficialTimetableProps {
  timetable: ConsolidatedTimetable
  schoolName: string
  examName: string
  examType: string
  academicSession: string
  dateRangeLabel: string
  startTime: string
  papersPerDay: number
}

interface DateGroup {
  date: string
  dayLabel: string
  rows: Array<Omit<ScheduleRow, 'cells'> & { cells: ConsolidatedTimetable['rows'][number]['cells'] }>
}

function groupRowsByDate(rows: ConsolidatedTimetable['rows']): DateGroup[] {
  const groups: DateGroup[] = []
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

export function OfficialTimetable({
  timetable,
  schoolName,
  examName,
  examType,
  academicSession,
  dateRangeLabel,
  startTime: _startTime,
  papersPerDay: _papersPerDay,
}: OfficialTimetableProps) {
  const dateGroups = useMemo(() => groupRowsByDate(timetable.rows), [timetable.rows])

  // Compute shift times from the first date group (all dates share the same shift schedule).
  const shiftTimes = useMemo(() => {
    if (dateGroups.length === 0 || dateGroups[0].rows.length === 0) return []
    return dateGroups[0].rows.map((r) => ({ label: dateGroups[0].rows.length === 1 ? '' : r.slotIndex === 0 ? '1st' : '2nd', startTime: r.startTime, endTime: r.endTime }))
  }, [dateGroups])

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      {/* ─── Document Header — centered ──────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border bg-gradient-to-br from-muted/40 to-transparent text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <GraduationCap className="h-4 w-4 text-primary" />
          <h1 className="text-base font-bold tracking-tight text-foreground">{schoolName}</h1>
        </div>
        <p className="text-sm font-semibold text-foreground">{examName}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Academic Session {academicSession} · {examType}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap mt-2">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            <span className="font-medium">{dateRangeLabel}</span>
          </div>
        </div>
        {/* Shift timings — shown ONCE here, not in every cell */}
        {shiftTimes.length > 1 && (
          <div className="flex items-center justify-center gap-4 mt-1.5">
            {shiftTimes.map((s, i) => (
              <span key={i} className="text-[10px] text-muted-foreground">
                <span className="font-semibold text-foreground">{s.label} Shift:</span> {s.startTime}–{s.endTime}
              </span>
            ))}
          </div>
        )}
        {shiftTimes.length === 1 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">Exam Time:</span> {shiftTimes[0].startTime}–{shiftTimes[0].endTime}
          </p>
        )}
        <h2 className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          Examination Timetable
        </h2>
      </div>

      {/* ─── Timetable Table ───────────────────────────────────────────── */}
      {timetable.rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          No examination dates in the selected window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-muted">
                <th className="sticky left-0 z-10 bg-muted px-2 py-1.5 text-left font-semibold text-[9px] uppercase tracking-wider text-muted-foreground border-b border-r border-border min-w-[80px]">
                  Day / Date
                </th>
                {shiftTimes.length > 1 && (
                  <th className="px-1 py-1.5 text-center font-semibold text-[9px] uppercase tracking-wider text-muted-foreground border-b border-r border-border/60 w-8">Shift</th>
                )}
                {timetable.columns.map((col) => (
                  <th key={col.gradeLevel} className="px-2 py-1.5 text-center font-semibold text-[9px] uppercase tracking-wider text-muted-foreground border-b border-r border-border/60 last:border-r-0 min-w-[100px]">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dateGroups.map((group) => (
                group.rows.map((row, slotWithinGroup) => (
                  <tr key={`${row.date}-${row.slotIndex}`} className="hover:bg-primary/5 transition-colors even:bg-muted/10">
                    {/* Day/Date cell — row-spans across all shifts for this date */}
                    {slotWithinGroup === 0 && (
                      <td rowSpan={group.rows.length} className="sticky left-0 z-[1] bg-card px-2.5 py-2 align-top border-b border-r border-border">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-medium uppercase text-muted-foreground">{row.dayLabel}</span>
                          <span className="text-[11px] font-semibold text-foreground tabular-nums">{formatDateLong(row.date)}</span>
                        </div>
                      </td>
                    )}
                    {/* Compact shift indicator — only for double-shift */}
                    {shiftTimes.length > 1 && (
                      <td className="px-1 py-1.5 text-center border-b border-r border-border/60">
                        <span className="text-[9px] font-medium text-muted-foreground">{row.slotIndex === 0 ? '1st' : '2nd'}</span>
                      </td>
                    )}
                    {/* Subject cells — subject name only; code shown as tiny badge on hover */}
                    {row.cells.map((cell, colIdx) => (
                      <td key={`${row.date}-${row.slotIndex}-${colIdx}`} className="border-b border-r border-border/60 last:border-r-0 px-2 py-1.5 align-middle min-w-[100px]">
                        {cell ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[11px] font-medium text-foreground text-center leading-tight">{cell.label}</span>
                            {cell.subjects.length > 0 && (
                              <span className="inline-flex items-center px-1 py-0.5 rounded text-[7px] font-mono font-semibold bg-muted/60 text-muted-foreground/80 leading-none">
                                {cell.subjects.map((s) => s.code).join(' / ')}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-center text-[9px] text-muted-foreground/25">—</div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Footer ───────────────────────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[9px] text-muted-foreground">
          {timetable.rows.length} examination slot{timetable.rows.length === 1 ? '' : 's'} · Sundays skipped
        </p>
        <p className="text-[9px] text-muted-foreground/70 italic">
          Official examination timetable — generated by Scholario-OS
        </p>
      </div>
    </div>
  )
}
