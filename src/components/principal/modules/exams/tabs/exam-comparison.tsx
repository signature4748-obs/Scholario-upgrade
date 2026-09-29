'use client'

/**
 * ExamComparison — cross-exam analytics comparison widget.
 *
 * Shows a side-by-side comparison of all exams in the current session:
 *   - Marks entry progress %
 *   - Results declared status
 *   - Class count / student count
 *   - Pass rate (for completed exams)
 *
 * Helps the Principal quickly see which exams are on track vs lagging.
 */

import { useMemo } from 'react'
import { GitCompare, TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CollapsibleSection } from '../collapsible-section'
import type { ExamDTO } from '@/lib/exams/types'

interface Props {
  exams: ExamDTO[]
  onSelectExam: (id: string) => void
}

export function ExamComparison({ exams, onSelectExam }: Props) {
  const comparisonData = useMemo(() => {
    return exams.map((exam) => {
      const totalStudents = exam.classes.reduce((s: number, c: any) => s + c.studentCount, 0)
      const marksPct = exam.markSummary.total > 0 ? Math.round((exam.markSummary.entered / exam.markSummary.total) * 100) : 0
      const lockedPct = exam.markSummary.total > 0 ? Math.round((exam.markSummary.locked / exam.markSummary.total) * 100) : 0
      const isCompleted = exam.status === 'Completed'
      const isDeclared = exam.resultStatus === 'Result Declared'
      return {
        id: exam.id,
        name: exam.name,
        type: exam.type,
        status: exam.status,
        resultStatus: exam.resultStatus,
        classCount: exam.classes.length,
        studentCount: totalStudents,
        subjectCount: exam.subjects.length,
        marksPct,
        lockedPct,
        isCompleted,
        isDeclared,
      }
    })
  }, [exams])

  if (comparisonData.length === 0) return null

  // Find the best and worst performing exams.
  const completedExams = comparisonData.filter((e) => e.isCompleted && e.lockedPct > 0)
  const bestExam = completedExams.length > 0
    ? completedExams.reduce((best, e) => e.lockedPct > best.lockedPct ? e : best)
    : null
  const laggingExams = comparisonData.filter((e) => !e.isCompleted && e.marksPct < 50 && e.marksPct > 0)

  return (
    <CollapsibleSection
      title="Exam Comparison"
      subtitle={`${comparisonData.length} exams`}
      accent="violet"
      defaultOpen={false}
    >
      <div className="p-3 space-y-3">
        {/* Highlights */}
        {(bestExam || laggingExams.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {bestExam && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0">
                  <TrendingUp className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Best Progress</p>
                  <p className="text-[11px] font-medium truncate">{bestExam.name} · {bestExam.lockedPct}% locked</p>
                </div>
              </div>
            )}
            {laggingExams.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                  <AlertCircle className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">Needs Attention</p>
                  <p className="text-[11px] font-medium truncate">{laggingExams.length} exam(s) below 50% marks entry</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Comparison table */}
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Exam</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Classes</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Students</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subjects</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Marks Entry</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Locked</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => onSelectExam(e.id)}
                  className="border-t border-border/30 hover:bg-muted/30 even:bg-muted/10 transition-colors cursor-pointer"
                >
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <GitCompare className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium truncate">{e.name}</p>
                        <p className="text-[9px] text-muted-foreground">{e.type}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{e.classCount}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{e.studentCount}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{e.subjectCount}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            e.marksPct === 100 ? 'bg-emerald-500' : e.marksPct > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30',
                          )}
                          style={{ width: `${e.marksPct}%` }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums shrink-0 w-8 text-right">{e.marksPct}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            e.lockedPct === 100 ? 'bg-emerald-500' : e.lockedPct > 0 ? 'bg-sky-500' : 'bg-muted-foreground/30',
                          )}
                          style={{ width: `${e.lockedPct}%` }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums shrink-0 w-8 text-right">{e.lockedPct}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {e.isDeclared ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Declared
                      </span>
                    ) : e.isCompleted ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20">
                        Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-muted/40 text-muted-foreground border border-border/40">
                        {e.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </CollapsibleSection>
  )
}
