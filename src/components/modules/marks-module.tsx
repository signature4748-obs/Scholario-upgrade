"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModuleCtx } from "@/lib/types";
import {
  PageHeader, SectionCard, StatCard, EmptyState, ErrorState, LoadingRows, LoadingGrid,
} from "@/components/modules/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { fmtDayDate, gradeFor } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ClipboardCheck, ChevronLeft, CheckCircle2, Award, TrendingUp, TrendingDown, Save,
} from "lucide-react";

/* ── payload types (server contract) ─────────────────────────── */

interface MySlot {
  id: string; examId: string; examName: string; term: string; examStatus: string;
  classId: string; className: string;
  subjectId: string; subjectName: string; subjectCode: string;
  maxMarks: number; heldOn: string | null; entered: number; total: number;
  isMineTeach: boolean; // subject teacher vs class-teacher duty
}

interface RosterRow {
  studentId: string; rollNo: number; name: string;
  obtained: number | null; grade: string | null;
}

interface Roster {
  examSubjectId: string; examName: string; term: string; examStatus: string;
  classId: string; className: string;
  subjectId: string; subjectName: string; subjectCode: string;
  maxMarks: number; heldOn: string | null; rows: RosterRow[];
}

const TERM_LABEL: Record<string, string> = {
  PA1: "PA 1", PA2: "PA 2", HALF_YEARLY: "Half-Yearly", ANNUAL: "Annual",
};

function gradeTone(grade: string | null): string {
  if (!grade) return "text-muted-foreground/50";
  if (grade === "F" || grade === "E") return "text-destructive";
  if (grade.startsWith("A")) return "text-success";
  return "text-foreground";
}

/* ── module root ─────────────────────────────────────────────── */

export function MarksModule({ ctx }: { ctx: ModuleCtx }) {
  return ctx.me.role === "TEACHER"
    ? <TeacherMarks name={ctx.me.name} />
    : <PrincipalMarks />;
}

/* ════════════════════════ TEACHER ════════════════════════ */

function TeacherMarks({ name }: { name: string }) {
  const [slot, setSlot] = useState<MySlot | null>(null);
  const q = useQuery({
    queryKey: ["marks", "mine"],
    queryFn: () => api<{ slots: MySlot[] }>("/api/marks?scope=mine"),
  });

  if (slot) {
    return <EntryView slot={slot} onBack={() => setSlot(null)} />;
  }

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Marks Entry" subtitle="Exams where you teach a subject or hold homeroom duty" />
        <LoadingGrid count={4} />
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load your marks sheets."} />;

  const slots = q.data.slots;
  const pending = slots.filter((s) => s.entered < s.total);
  const done = slots.filter((s) => s.entered >= s.total && s.total > 0);
  const next = pending.slice().sort((a, b) => (a.heldOn ?? "9999").localeCompare(b.heldOn ?? "9999"))[0];
  const first = name.split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marks Entry"
        subtitle={`${slots.length} marks sheet${slots.length === 1 ? "" : "s"} assigned to you — pending ones first`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Pending entry"
          value={pending.length}
          sub={pending.length ? "Incomplete sheets need your marks" : "Nothing waiting on you"}
          icon={ClipboardCheck}
          tone={pending.length ? "warning" : "success"}
        />
        <StatCard
          label="Completed"
          value={done.length}
          sub={`${slots.length - pending.length} of ${slots.length} sheets done`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Next to prepare"
          value={next ? next.subjectCode : "—"}
          sub={next ? (next.heldOn ? `Held ${fmtDayDate(next.heldOn)}` : `Date not set — ${next.className}`) : `All caught up, ${first}`}
          icon={Award}
        />
      </div>

      {slots.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No marks sheets assigned to you"
          hint="Sheets appear here when an exam has subject slots for classes you teach or homeroom."
        />
      ) : (
        <>
          {pending.length > 0 && (
            <SectionCard title="Pending entry" description="Enter marks for these subject sheets">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pending.map((s) => (
                  <SlotCard key={s.id} slot={s} onPick={() => setSlot(s)} />
                ))}
              </div>
            </SectionCard>
          )}
          {done.length > 0 && (
            <SectionCard title="Completed" description="Fully entered — reopen to review or correct">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {done.map((s) => (
                  <SlotCard key={s.id} slot={s} onPick={() => setSlot(s)} muted />
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

function SlotCard({ slot, onPick, muted }: { slot: MySlot; onPick: () => void; muted?: boolean }) {
  const pct = slot.total > 0 ? Math.round((slot.entered / slot.total) * 100) : 0;
  return (
    <Card className={cn("gap-3 py-4 transition-all", muted ? "opacity-80" : "hover:shadow-md hover:ring-1 hover:ring-primary/25")}>
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="px-2 text-[11px] font-medium">
              {TERM_LABEL[slot.term] ?? slot.term}
            </Badge>
            {muted && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> complete
              </span>
            )}
          </div>
          <span className="truncate text-[11.5px] text-muted-foreground">{slot.examName.replace(/ — \d{4}-\d{2}/, "")}</span>
        </div>
        <div className="mt-2 text-[14px] font-semibold leading-snug">
          {slot.className} · {slot.subjectName}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          {slot.heldOn ? `Held ${fmtDayDate(slot.heldOn)}` : "Date not set"} ·{" "}
          {slot.isMineTeach ? "you teach this subject" : "homeroom duty"}
        </div>
        <div className="mt-3">
          <div className="tnum mb-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span>{slot.entered}/{slot.total} entered</span>
            <span>{slot.entered === 0 ? "not started" : `${pct}%`}</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
        <Button size="sm" variant={muted ? "outline" : "default"} className="mt-3 w-full" onClick={onPick}>
          {muted ? "Review marks" : slot.entered === 0 ? "Enter marks" : "Continue entry"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── teacher entry view ──────────────────────────────────────── */

function EntryView({ slot, onBack }: { slot: MySlot; onBack: () => void }) {
  const q = useQuery({
    queryKey: ["marks", "roster", slot.examId, slot.classId, slot.subjectId],
    queryFn: () => api<Roster>(`/api/marks?examId=${slot.examId}&classId=${slot.classId}&subjectId=${slot.subjectId}`),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" /> All sheets</Button>
        <LoadingRows rows={12} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load the roster."} />;

  const roster = q.data;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="h-4 w-4" /> All sheets
        </Button>
        <PageHeader
          title={`${roster.className} · ${roster.subjectName}`}
          subtitle={`${roster.examName} · max ${roster.maxMarks} marks · ${roster.heldOn ? `held ${fmtDayDate(roster.heldOn)}` : "date not set"}`}
        />
        <div className="tnum -mt-4 text-[12.5px] text-muted-foreground">
          {roster.rows.filter((r) => r.obtained != null).length}/{roster.rows.length} filled — empty rows stay “—” (never zero)
        </div>
      </div>

      {roster.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No students in this class"
          hint="The roster is empty, so there is nobody to mark."
        />
      ) : (
        <EntryGrid key={`${roster.examSubjectId}-${q.dataUpdatedAt}`} roster={roster} />
      )}
    </div>
  );
}

function EntryGrid({ roster }: { roster: Roster }) {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const r of roster.rows) v[r.studentId] = r.obtained != null ? String(r.obtained) : "";
    return v;
  });

  const save = useMutation({
    mutationFn: (body: object) => api("/api/marks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (d: any) => {
      toast.success(`Marks saved for ${roster.className} ${roster.subjectName}${d?.saved ? ` — ${d.saved} entries` : ""}`);
      qc.invalidateQueries({ queryKey: ["marks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const max = roster.maxMarks;
  const filledCount = Object.values(vals).filter((v) => v !== "").length;

  const setVal = (sid: string, raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, "").slice(0, 3);
    setVals((m) => ({ ...m, [sid]: cleaned }));
  };

  const submit = () => {
    const marks: { studentId: string; obtained: number }[] = [];
    let bad = false;
    for (const r of roster.rows) {
      const v = vals[r.studentId] ?? "";
      if (v === "") continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) bad = true;
      else marks.push({ studentId: r.studentId, obtained: n });
    }
    if (bad) return toast.error(`Marks must be between 0 and ${max}. Fix the highlighted rows.`);
    if (marks.length === 0) return toast.error("Enter at least one mark before saving.");
    save.mutate({ examSubjectId: roster.examSubjectId, marks });
  };

  const saveBtn = (
    <Button size="sm" onClick={submit} disabled={save.isPending}>
      <Save className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save marks"}
    </Button>
  );

  return (
    <SectionCard
      title="Marks sheet"
      description="Type obtained marks — the grade previews against the CBSE scale as you go"
      actions={saveBtn}
      contentClassName="pt-0"
    >
      <div className="max-h-[62vh] overflow-y-auto scroll-slim">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14">Roll</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="w-28 text-right">Marks / {max}</TableHead>
              <TableHead className="w-16 text-center">Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.rows.map((r) => {
              const v = vals[r.studentId] ?? "";
              const n = v === "" ? null : Number(v);
              const invalid = n != null && (!Number.isInteger(n) || n < 0 || n > max);
              const grade = n != null && !invalid ? gradeFor((n / max) * 100) : null;
              return (
                <TableRow key={r.studentId} className={cn(invalid && "bg-destructive/5")}>
                  <TableCell className="tnum text-[13px] text-muted-foreground">{r.rollNo}</TableCell>
                  <TableCell className="text-[13px] font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={v}
                      onChange={(e) => setVal(r.studentId, e.target.value)}
                      placeholder="—"
                      aria-label={`Marks for ${r.name}`}
                      aria-invalid={invalid || undefined}
                      className={cn(
                        "tnum h-8 w-24 text-right",
                        invalid && "border-destructive text-destructive",
                      )}
                    />
                  </TableCell>
                  <TableCell className={cn("tnum text-center text-[12.5px] font-semibold", gradeTone(grade))}>
                    {grade ?? (invalid ? "!" : "—")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
        <span className="tnum text-[12.5px] text-muted-foreground">
          {filledCount}/{roster.rows.length} filled · saving updates existing rows — reopen anytime to correct a mark
        </span>
        {saveBtn}
      </div>
    </SectionCard>
  );
}

/* ════════════════════════ PRINCIPAL (read-only) ════════════════════════ */

interface ExamSummary { id: string; name: string; term: string; status: string }
interface SlotBrief {
  id: string; subjectId: string; subjectName: string; subjectCode: string;
  maxMarks: number; heldOn: string | null; entered: number; total: number;
}
interface ExamDetailLite {
  exam: { id: string; name: string; term: string; status: string; startsOn: string; endsOn: string };
  groups: { classId: string; className: string; strength: number; slots: SlotBrief[] }[];
}

function PrincipalMarks() {
  const [sel, setSel] = useState<{ examId: string; classId: string; subjectId: string }>({
    examId: "", classId: "", subjectId: "",
  });
  const { examId, classId, subjectId } = sel;

  const examsQ = useQuery({
    queryKey: ["exams"],
    queryFn: () => api<{ exams: ExamSummary[] }>("/api/exams"),
  });
  const detailQ = useQuery({
    queryKey: ["exam", examId],
    queryFn: () => api<ExamDetailLite>(`/api/exams/${examId}`),
    enabled: !!examId,
  });
  const rosterQ = useQuery({
    queryKey: ["marks", "roster", examId, classId, subjectId],
    queryFn: () => api<Roster>(`/api/marks?examId=${examId}&classId=${classId}&subjectId=${subjectId}`),
    enabled: !!examId && !!classId && !!subjectId,
  });

  const exams = examsQ.data?.exams ?? [];
  const groups = detailQ.data?.groups ?? [];
  const group = groups.find((g) => g.classId === classId);
  const slots = group?.slots ?? [];

  if (examsQ.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Marks Entry" subtitle="Read-only browser — pick an exam, class and subject" />
        <LoadingRows rows={8} />
      </div>
    );
  }
  if (examsQ.isError || !examsQ.data) return <ErrorState message={(examsQ.error as Error)?.message ?? "Could not load exams."} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marks Entry"
        subtitle={`Read-only browser — teachers enter, you review (${exams.length} exams)`}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Exam</Label>
          <Select value={examId} onValueChange={(v) => setSel({ examId: v, classId: "", subjectId: "" })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Pick exam" /></SelectTrigger>
            <SelectContent>
              {exams.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Class</Label>
          <Select
            value={classId}
            onValueChange={(v) => setSel({ ...sel, classId: v, subjectId: "" })}
            disabled={!examId || detailQ.isLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={examId ? (detailQ.isLoading ? "Loading…" : "Pick class") : "Pick exam first"} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.classId} value={g.classId}>{g.className}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Select value={subjectId} onValueChange={(v) => setSel({ ...sel, subjectId: v })} disabled={!classId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={classId ? (slots.length ? "Pick subject" : "No slots") : "Pick class first"} />
            </SelectTrigger>
            <SelectContent>
              {slots.map((s) => (
                <SelectItem key={s.id} value={s.subjectId}>
                  {s.subjectName}
                  {s.entered < s.total ? ` · ${s.entered}/${s.total}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!examId ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Pick an exam to browse marks"
          hint="Choose an exam, then a class and subject — PA 1 already has marks entered; Half-Yearly does not yet."
        />
      ) : rosterQ.isLoading ? (
        <LoadingRows rows={10} />
      ) : rosterQ.isError ? (
        <ErrorState message={(rosterQ.error as Error)?.message ?? "Could not load the marks sheet."} />
      ) : rosterQ.data ? (
        <PrincipalRoster roster={rosterQ.data} />
      ) : null}
    </div>
  );
}

function PrincipalRoster({ roster }: { roster: Roster }) {
  const entered = roster.rows.filter((r) => r.obtained != null);
  const pcts = entered.map((r) => (r.obtained! / roster.maxMarks) * 100);
  const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  const highest = pcts.length ? Math.max(...pcts) : null;
  const lowest = pcts.length ? Math.min(...pcts) : null;
  const passCount = pcts.filter((p) => p >= 33).length;
  const passPct = pcts.length ? Math.round((passCount / pcts.length) * 100) : null;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Class average" value={avg != null ? `${avg.toFixed(1)}%` : "—"} sub={`${entered.length} of ${roster.rows.length} marked`} icon={TrendingUp} tone="primary" />
        <StatCard label="Highest" value={highest != null ? `${highest.toFixed(1)}%` : "—"} sub={`out of ${roster.maxMarks}`} icon={Award} />
        <StatCard label="Lowest" value={lowest != null ? `${lowest.toFixed(1)}%` : "—"} sub="entered marks only" icon={TrendingDown} />
        <StatCard label="Pass rate" value={passPct != null ? `${passPct}%` : "—"} sub="CBSE pass at 33%" icon={CheckCircle2} tone={passPct != null && passPct < 75 ? "warning" : "success"} />
      </div>

      {entered.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No marks entered yet"
          hint={`${roster.className} ${roster.subjectName} is scheduled${roster.heldOn ? ` for ${fmtDayDate(roster.heldOn)}` : ""} — the sheet is still blank.`}
        />
      ) : (
        <SectionCard
          title={`${roster.className} · ${roster.subjectName}`}
          description={`${roster.examName} · max ${roster.maxMarks} marks${roster.heldOn ? ` · held ${fmtDayDate(roster.heldOn)}` : ""}`}
          contentClassName="pt-0"
        >
          <div className="max-h-[62vh] overflow-y-auto scroll-slim">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-14">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="w-28 text-right">Marks / {roster.maxMarks}</TableHead>
                  <TableHead className="w-16 text-center">Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.rows.map((r) => (
                  <TableRow key={r.studentId}>
                    <TableCell className="tnum text-[13px] text-muted-foreground">{r.rollNo}</TableCell>
                    <TableCell className="text-[13px] font-medium">{r.name}</TableCell>
                    <TableCell className="tnum text-right text-[13px]">
                      {r.obtained != null ? r.obtained : <span className="text-muted-foreground/60">—</span>}
                    </TableCell>
                    <TableCell className={cn("tnum text-center text-[12.5px] font-semibold", gradeTone(r.grade))}>
                      {r.grade ?? <span className="text-muted-foreground/60">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
    </>
  );
}
