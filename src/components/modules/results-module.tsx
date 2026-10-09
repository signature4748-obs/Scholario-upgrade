"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ModuleCtx } from "@/lib/types";
import { fmtDayDate, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid, StatusDot,
} from "@/components/modules/kit";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Award, CalendarClock, ClipboardCheck, Trophy } from "lucide-react";

interface SubjectRow {
  subject: string;
  code: string;
  maxMarks: number;
  passMarks: number;
  passAt: number;
  obtained: number | null;
  grade: string | null;
  classAvg: number | null;
}

interface Overall {
  totalObtained: number;
  totalMax: number;
  pct: number;
  grade: string;
  best: { subject: string; pct: number } | null;
}

interface ExamEntry {
  id: string;
  name: string;
  term: string;
  status: string;
  startsOn: string;
  endsOn: string;
  published: boolean;
  subjects: SubjectRow[];
  datesheet: { subject: string; heldOn: string }[];
  overall: Overall | null;
}

interface ResultsPayload {
  className: string;
  exams: ExamEntry[];
}

export function ResultsModule({ ctx }: { ctx: ModuleCtx }) {
  const q = useQuery({
    queryKey: ["results"],
    queryFn: () => api<ResultsPayload>("/api/results"),
  });
  const [examId, setExamId] = useState<string | null>(null);

  const selected = useMemo(() => {
    const exams = q.data?.exams ?? [];
    if (!exams.length) return null;
    return exams.find((e) => e.id === examId) ?? exams[0];
  }, [q.data, examId]);

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="My Results" subtitle="Published exam results, subject by subject." />
        <LoadingGrid count={3} />
        <div className="mt-6">
          <LoadingRows rows={8} />
        </div>
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="My Results" />
        <ErrorState message={(q.error as Error).message} />
      </>
    );
  }

  const d = q.data!;
  if (!d.exams.length) {
    return (
      <>
        <PageHeader title="My Results" subtitle={`Exam results for ${d.className}.`} />
        <EmptyState
          icon={Trophy}
          title="No exams for your class yet"
          hint="When the school schedules an exam for your section and publishes its results, they will appear here."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My Results"
        subtitle={`Published exam results for ${d.className}.`}
        actions={
          <Select
            value={selected?.id ?? d.exams[0].id}
            onValueChange={(v) => setExamId(v)}
          >
            <SelectTrigger className="w-full sm:w-80" aria-label="Choose exam">
              <SelectValue placeholder="Choose exam" />
            </SelectTrigger>
            <SelectContent>
              {d.exams.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="truncate">{e.name}</span>
                  <span
                    className={cn(
                      "ml-2 shrink-0 text-[11px]",
                      e.published ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {e.published ? "published" : "awaited"}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {!selected ? null : selected.published ? (
        <PublishedExam exam={selected} />
      ) : (
        <AwaitedExam exam={selected} />
      )}
    </>
  );
}

/* ── published exam ────────────────────────────────────────────── */

function PublishedExam({ exam }: { exam: ExamEntry }) {
  const o = exam.overall;
  const entered = exam.subjects.filter((s) => s.obtained != null);

  return (
    <>
      {o ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Total marks"
            value={<span className="tnum">{o.totalObtained}</span>}
            sub={`out of ${o.totalMax} across ${entered.length} subjects`}
            icon={ClipboardCheck}
          />
          <StatCard
            label="Percentage"
            value={<span className="tnum">{o.pct}%</span>}
            sub={o.best ? `Best subject — ${o.best.subject} (${o.best.pct}%)` : undefined}
            icon={Trophy}
            tone="primary"
          />
          <StatCard
            label="Overall grade"
            value={o.grade}
            sub="CBSE nine-point scale"
            icon={Award}
            tone={o.pct >= 33 ? "success" : "destructive"}
          />
        </div>
      ) : (
        <EmptyState
          icon={ClipboardCheck}
          title="Your marks are not in yet"
          hint={`${exam.name} is published, but no marks have been entered against your roll for ${exam.subjects.length || "your"} subjects. Check with your class teacher.`}
        />
      )}

      <SectionCard
        className="mt-6"
        title={exam.name}
        description={`Held ${fmtDate(exam.startsOn)} – ${fmtDate(exam.endsOn)} · published results.`}
        contentClassName="p-4 pt-0"
      >
        {exam.subjects.length === 0 ? (
          <EmptyState
            title="No subject papers for your class"
            hint="This exam has no subject slots recorded for your section."
          />
        ) : (
          <div className="max-h-[30rem] overflow-y-auto scroll-slim rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Class avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exam.subjects.map((s) => {
                  const pct = s.obtained != null && s.maxMarks > 0 ? (s.obtained / s.maxMarks) * 100 : null;
                  const passed = s.obtained != null && s.obtained >= s.passAt;
                  return (
                    <TableRow key={s.code + s.subject}>
                      <TableCell className="font-medium">{s.subject}</TableCell>
                      <TableCell>
                        {s.obtained != null ? (
                          <div className="w-36 sm:w-44">
                            <div className="tnum text-[13px] font-medium">
                              {s.obtained} <span className="font-normal text-muted-foreground">/ {s.maxMarks}</span>
                            </div>
                            <Progress
                              value={pct ?? 0}
                              className={cn(
                                "mt-1.5 h-1.5 bg-muted",
                                passed
                                  ? "[&_[data-slot=progress-indicator]]:bg-success"
                                  : "[&_[data-slot=progress-indicator]]:bg-destructive",
                              )}
                              aria-label={`${s.subject}: ${s.obtained} of ${s.maxMarks}`}
                            />
                            <p
                              className={cn(
                                "mt-1 text-[10.5px]",
                                passed ? "text-muted-foreground/70" : "text-destructive",
                              )}
                            >
                              {passed
                                ? `pass at ${s.passAt}`
                                : `below pass mark (${s.passAt} / ${s.maxMarks})`}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">— not entered</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.grade ? (
                          <Badge variant={s.obtained != null && s.obtained < s.passAt ? "destructive" : "secondary"}>
                            {s.grade}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tnum text-right text-[12.5px] text-muted-foreground">
                        {s.classAvg != null ? `${s.classAvg} / ${s.maxMarks}` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

/* ── awaited exam ──────────────────────────────────────────────── */

function AwaitedExam({ exam }: { exam: ExamEntry }) {
  return (
    <>
      <EmptyState
        icon={CalendarClock}
        title={`Results awaited — ${exam.name}`}
        hint={`${exam.name} runs ${fmtDayDate(exam.startsOn)} to ${fmtDayDate(exam.endsOn)}. Scores appear here the moment the school office publishes them — nothing is shown before that.`}
      />
      {exam.datesheet.length > 0 && (
        <SectionCard
          className="mt-6"
          title="Datesheet for your class"
          description={`${exam.datesheet.length} papers scheduled.`}
          actions={<StatusDot status={exam.status} />}
        >
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {exam.datesheet.map((sl) => (
              <li key={sl.subject + sl.heldOn} className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5">
                <span className="text-[13px] font-medium">{sl.subject}</span>
                <span className="tnum text-[12px] text-muted-foreground">{fmtDayDate(sl.heldOn)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}
