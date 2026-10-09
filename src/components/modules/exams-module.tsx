"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModuleCtx } from "@/lib/types";
import {
  PageHeader, SectionCard, EmptyState, ErrorState, LoadingGrid, LoadingRows,
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { fmtDate, fmtDayDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, ClipboardList, Plus, Send,
} from "lucide-react";

/* ── payload types (server contract) ─────────────────────────── */

interface SubjectRef { id: string; code: string; name: string }
interface ClassRef { id: string; name: string; gradeLevel: number; subjects: SubjectRef[] }
interface ExamSummary {
  id: string; name: string; term: string; status: string;
  startsOn: string; endsOn: string; slotCount: number; entered: number; avgPct: number | null;
}
interface ExamsPayload { exams: ExamSummary[]; classes: ClassRef[] }

interface SlotRow {
  id: string; subjectId: string; subjectCode: string; subjectName: string;
  maxMarks: number; heldOn: string | null; entered: number; total: number; avgPct: number | null;
}
interface ClassGroup {
  classId: string; className: string; strength: number; avgPct: number | null; slots: SlotRow[];
}
interface ExamDetail {
  exam: { id: string; name: string; term: string; status: string; startsOn: string; endsOn: string };
  groups: ClassGroup[];
}

const TERM_LABEL: Record<string, string> = {
  PA1: "PA 1", PA2: "PA 2", HALF_YEARLY: "Half-Yearly", ANNUAL: "Annual",
};
const TERMS = ["PA1", "HALF_YEARLY", "PA2", "ANNUAL"] as const;

function termLabel(term: string) { return TERM_LABEL[term] ?? term; }

function ExamStatusBadge({ status }: { status: string }) {
  const cls =
    status === "PUBLISHED" ? "border-success/25 bg-success/10 text-success"
    : status === "ONGOING" ? "border-info/25 bg-info/10 text-info"
    : "border-warning/30 bg-warning/15 text-warning-foreground dark:text-warning";
  return (
    <Badge variant="outline" className={cn("px-2 text-[11px] font-medium capitalize", cls)}>
      {status.toLowerCase()}
    </Badge>
  );
}

/* ── module root ─────────────────────────────────────────────── */

export function ExamsModule({ ctx }: { ctx: ModuleCtx }) {
  const [selId, setSelId] = useState<string | null>(null);

  if (ctx.me.role !== "PRINCIPAL") {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Examinations are managed by the office"
        hint="Marks entry for your subjects lives in the Marks Entry module."
      />
    );
  }

  return selId
    ? <ExamDetail examId={selId} onBack={() => setSelId(null)} />
    : <ExamList academicYear={ctx.me.school.academicYear} onOpen={setSelId} />;
}

/* ── list view ───────────────────────────────────────────────── */

function ExamList({ academicYear, onOpen }: { academicYear: string; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["exams"], queryFn: () => api<ExamsPayload>("/api/exams") });
  const [newOpen, setNewOpen] = useState(false);

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Examinations" subtitle="Assessment calendar across the session" />
        <LoadingGrid count={3} />
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load examinations."} />;

  const { exams } = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examinations"
        subtitle={`${exams.length} exam${exams.length === 1 ? "" : "s"} on the ${academicYear} calendar`}
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New exam
          </Button>
        }
      />

      {exams.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title="No examinations yet"
          hint="Create the first exam to start building its datesheet — subject slots follow in the detail view."
          action={<Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-3.5 w-3.5" /> New exam</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {exams.map((e) => (
            <Card
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(e.id)}
              onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onOpen(e.id)}
              className="group gap-3 py-4 transition-all hover:shadow-md hover:ring-1 hover:ring-primary/25 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CardContent className="px-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="px-2 text-[11px] font-medium">{termLabel(e.term)}</Badge>
                    <ExamStatusBadge status={e.status} />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                </div>
                <div className="mt-2.5 font-display text-[15px] font-semibold leading-snug tracking-tight">{e.name}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                  {fmtDate(e.startsOn)} – {fmtDate(e.endsOn)}
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3 text-[12.5px]">
                  <span className="text-muted-foreground">
                    <span className="tnum font-semibold text-foreground">{e.slotCount}</span>{" "}
                    subject slot{e.slotCount === 1 ? "" : "s"}
                  </span>
                  {e.status === "PUBLISHED" && e.avgPct != null ? (
                    <span className="text-muted-foreground">
                      School average{" "}
                      <span className="tnum font-semibold text-primary">{e.avgPct}%</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      <span className="tnum font-semibold text-foreground">{e.entered}</span> marks entered
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewExamDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

/* ── new exam dialog ─────────────────────────────────────────── */

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function NewExamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [term, setTerm] = useState<string>("PA2");
  const [startsOn, setStartsOn] = useState(todayISO());
  const [endsOn, setEndsOn] = useState(todayISO());

  const create = useMutation({
    mutationFn: (body: object) => api("/api/exams", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_d, vars: any) => {
      toast.success(`Exam created — ${vars.name}`);
      onOpenChange(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["exams"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!name.trim()) return toast.error("Give the exam a name.");
    if (!term) return toast.error("Pick a term.");
    if (!startsOn || !endsOn) return toast.error("Set the exam window dates.");
    if (endsOn < startsOn) return toast.error("The exam cannot end before it starts.");
    create.mutate({ name: name.trim(), term, startsOn, endsOn });
  };

  const defaultName = term ? `${TERM_LABEL[term] ?? term} Examination — ${new Date().getFullYear()}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create an examination</DialogTitle>
          <DialogDescription>Sets up the shell — subject slots are added per class afterwards.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="exam-name">Name</Label>
            <Input
              id="exam-name"
              placeholder={defaultName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-[11.5px] text-muted-foreground">Leave empty to use “{defaultName}”.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Term</Label>
              <Select value={term} onValueChange={setTerm}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TERMS.map((t) => (
                    <SelectItem key={t} value={t}>{TERM_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Max-marks default</Label>
              <Input value="100" disabled className="tnum bg-muted/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="exam-start">Starts on</Label>
              <Input id="exam-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-end">Ends on</Label>
              <Input id="exam-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create exam"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── detail view ─────────────────────────────────────────────── */

function ExamDetail({ examId, onBack }: { examId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exam", examId], queryFn: () => api<ExamDetail>(`/api/exams/${examId}`) });
  const classesQ = useQuery({ queryKey: ["exams"], queryFn: () => api<ExamsPayload>("/api/exams") });
  const [slotOpen, setSlotOpen] = useState(false);

  const publish = useMutation({
    mutationFn: () => api(`/api/exams/${examId}`, { method: "PATCH", body: JSON.stringify({ status: "PUBLISHED" }) }),
    onSuccess: () => {
      toast.success("Results published — averages are now visible school-wide.");
      qc.invalidateQueries({ queryKey: ["exams"] });
      qc.invalidateQueries({ queryKey: ["exam", examId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" /> All exams</Button>
        <LoadingRows rows={10} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load this exam."} />;

  const { exam, groups } = q.data;
  const totalSlots = groups.reduce((n, g) => n + g.slots.length, 0);
  const published = exam.status === "PUBLISHED";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="h-4 w-4" /> All exams
        </Button>
        <PageHeader
          title={exam.name}
          subtitle={`${termLabel(exam.term)} · ${fmtDate(exam.startsOn)} – ${fmtDate(exam.endsOn)} · ${totalSlots} subject slot${totalSlots === 1 ? "" : "s"} across ${groups.length} section${groups.length === 1 ? "" : "s"}`}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setSlotOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add subject slot
              </Button>
              {!published && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm"><Send className="h-3.5 w-3.5" /> Publish results</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Publish {exam.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Results become visible on student report cards. Subjects whose marks are still
                        incomplete will show honestly as “—” for missing students — teachers can keep
                        filling them in after publishing.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Not yet</AlertDialogCancel>
                      <AlertDialogAction onClick={() => publish.mutate()} disabled={publish.isPending}>
                        {publish.isPending ? "Publishing…" : "Publish results"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="px-2 text-[11px] font-medium">{termLabel(exam.term)}</Badge>
          <ExamStatusBadge status={exam.status} />
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No subject slots yet"
          hint="Add the first subject slot to build this exam's datesheet — one row per class and subject."
          action={<Button size="sm" onClick={() => setSlotOpen(true)}><Plus className="h-3.5 w-3.5" /> Add subject slot</Button>}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <SectionCard
              key={g.classId}
              title={g.className}
              description={`${g.strength} students · ${g.slots.length} subject${g.slots.length === 1 ? "" : "s"}`}
              actions={
                published && g.avgPct != null ? (
                  <Badge variant="outline" className="tnum border-primary/25 bg-primary/5 px-2 text-[11.5px] font-medium text-primary">
                    Class average {g.avgPct}%
                  </Badge>
                ) : undefined
              }
              contentClassName="pt-0"
            >
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Subject</TableHead>
                    <TableHead className="w-20 text-right">Max</TableHead>
                    <TableHead className="w-28">Held on</TableHead>
                    <TableHead className="w-44">Marks entered</TableHead>
                    {published && <TableHead className="w-24 text-right">Average</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.slots.map((s) => {
                    const pct = s.total > 0 ? Math.round((s.entered / s.total) * 100) : 0;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="px-1.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground">
                              {s.subjectCode}
                            </Badge>
                            <span className="text-[13px] font-medium">{s.subjectName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="tnum text-right text-[13px]">{s.maxMarks}</TableCell>
                        <TableCell className="text-[12.5px] text-muted-foreground">
                          {s.heldOn ? fmtDayDate(s.heldOn) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="w-36">
                            <div className="tnum mb-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
                              <span>{s.entered}/{s.total}</span>
                              <span>{s.entered === 0 ? "not started" : `${pct}%`}</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        </TableCell>
                        {published && (
                          <TableCell className="tnum text-right text-[13px] font-medium">
                            {s.avgPct != null ? `${s.avgPct}%` : "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionCard>
          ))}
        </div>
      )}

      <AddSlotDialog
        open={slotOpen}
        onOpenChange={setSlotOpen}
        examId={examId}
        examStartsOn={exam.startsOn}
        classes={classesQ.data?.classes ?? []}
        existingGroups={groups}
      />
    </div>
  );
}

/* ── add subject slot dialog ─────────────────────────────────── */

function AddSlotDialog({
  open, onOpenChange, examId, examStartsOn, classes, existingGroups,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; examId: string; examStartsOn: string;
  classes: ClassRef[]; existingGroups: ClassGroup[];
}) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [heldOn, setHeldOn] = useState(examStartsOn);

  const klass = classes.find((c) => c.id === classId);
  const alreadySlotted = new Set(
    (existingGroups.find((g) => g.classId === classId)?.slots ?? []).map((s) => s.subjectId),
  );
  const subjects = (klass?.subjects ?? []).filter((s) => !alreadySlotted.has(s.id));

  const add = useMutation({
    mutationFn: (body: object) => api(`/api/exams/${examId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success(`Subject slot added for ${klass?.name ?? "class"}`);
      onOpenChange(false);
      setSubjectId("");
      qc.invalidateQueries({ queryKey: ["exam", examId] });
      qc.invalidateQueries({ queryKey: ["exams"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!classId) return toast.error("Pick a class first.");
    if (!subjectId) return toast.error("Pick a subject for the slot.");
    const mm = Number(maxMarks);
    if (!Number.isInteger(mm) || mm < 1 || mm > 500) return toast.error("Max marks must be a whole number between 1 and 500.");
    if (!heldOn) return toast.error("Pick the exam date for this subject.");
    add.mutate({ classId, subjectId, maxMarks: mm, heldOn });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setClassId(""); setSubjectId(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a subject slot</DialogTitle>
          <DialogDescription>One row per class and subject — sets the datesheet and marks sheet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={classId} onValueChange={(v) => { setClassId(v); setSubjectId(""); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={classes.length ? "Pick class" : "…"} />
                </SelectTrigger>
                <SelectContent>
                  {classes.filter((c) => c.subjects.length > 0).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId} disabled={!classId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={classId ? (subjects.length ? "Pick subject" : "All subjects added") : "Pick class first"} />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="slot-max">Max marks</Label>
              <Input id="slot-max" type="number" min={1} max={500} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} className="tnum" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot-date">Held on</Label>
              <Input id="slot-date" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={add.isPending || !subjectId}>
            {add.isPending ? "Adding…" : "Add slot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
