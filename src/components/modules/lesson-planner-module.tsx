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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { fmtDayDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BookOpen, CheckCircle2, Minus, NotebookPen, Package, Plus, SkipForward, Trash2,
} from "lucide-react";

/* ── payload types (server contract) ─────────────────────────── */

interface Plan {
  id: string; classId: string; className: string;
  subjectId: string; subjectName: string; subjectCode: string;
  topic: string; objectives: string | null; materials: string | null;
  date: string; periods: number; status: string;
}
interface SubjectRef { id: string; code: string; name: string }
interface MyClass { id: string; name: string; subjects: SubjectRef[] }

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function statusBadge(status: string) {
  if (status === "TAUGHT") return <Badge variant="outline" className="border-success/25 bg-success/10 px-2 text-[11px] font-medium capitalize text-success">taught</Badge>;
  if (status === "SKIPPED") return <Badge variant="outline" className="border-muted bg-muted/50 px-2 text-[11px] font-medium capitalize text-muted-foreground">skipped</Badge>;
  return <Badge variant="outline" className="border-warning/30 bg-warning/15 px-2 text-[11px] font-medium capitalize text-warning-foreground dark:text-warning">draft</Badge>;
}

/* ── module root ─────────────────────────────────────────────── */

export function LessonPlannerModule({ ctx }: { ctx: ModuleCtx }) {
  const q = useQuery({
    queryKey: ["lessons"],
    queryFn: () => api<{ plans: Plan[]; classes: MyClass[] }>("/api/lesson-plans"),
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  if (ctx.me.role !== "TEACHER") {
    return (
      <EmptyState
        icon={NotebookPen}
        title="Lesson plans belong to teachers"
        hint="This workspace is where faculty prepare and close out their daily lesson plans."
      />
    );
  }

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Lesson Planner" subtitle="Prepare, teach, and close out your lessons" />
        <LoadingGrid count={3} />
        <LoadingRows rows={6} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load your lesson plans."} />;

  const { plans, classes } = q.data;
  const drafts = plans.filter((p) => p.status === "DRAFT");
  const taught = plans.filter((p) => p.status === "TAUGHT");
  const skipped = plans.filter((p) => p.status === "SKIPPED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lesson Planner"
        subtitle={`${plans.length} plan${plans.length === 1 ? "" : "s"} · classes you teach in ${ctx.me.school.shortName ?? ctx.me.school.name}`}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)} disabled={classes.length === 0}>
            <Plus className="h-3.5 w-3.5" /> New plan
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Drafts" value={drafts.length} sub={drafts.length ? "Waiting to be taught" : "Nothing pending"} icon={NotebookPen} tone={drafts.length ? "warning" : "success"} />
        <StatCard label="Taught" value={taught.length} sub="Closed out this term" icon={CheckCircle2} tone="success" />
        <StatCard label="Skipped" value={skipped.length} sub="Carried over or dropped" icon={SkipForward} />
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={classes.length === 0 ? "You don’t teach any subjects yet" : "No lesson plans yet"}
          hint={classes.length === 0
            ? "Once the office assigns you subjects in classes, plan your lessons here."
            : "Create your first plan — pick a class you teach, a subject, and the topic you’ll cover."}
          action={classes.length > 0 ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="h-3.5 w-3.5" /> New plan</Button>
          ) : undefined}
        />
      ) : (
        <div className="space-y-6">
          {drafts.length > 0 && (
            <SectionCard title="Drafts" description="Open plans — mark them taught or skipped once the period is done">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {drafts.map((p) => <PlanCard key={p.id} plan={p} />)}
              </div>
            </SectionCard>
          )}
          {taught.length > 0 && (
            <SectionCard title="Taught" description="Completed lessons">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {taught.map((p) => <PlanCard key={p.id} plan={p} muted />)}
              </div>
            </SectionCard>
          )}
          {skipped.length > 0 && (
            <SectionCard title="Skipped" description="Set aside — revisit the topic later">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {skipped.map((p) => <PlanCard key={p.id} plan={p} muted />)}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      <NewPlanDialog open={dialogOpen} onOpenChange={setDialogOpen} classes={classes} />
    </div>
  );
}

/* ── plan card ───────────────────────────────────────────────── */

function PlanCard({ plan, muted }: { plan: Plan; muted?: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["lessons"] });

  const mark = useMutation({
    mutationFn: (status: string) =>
      api("/api/lesson-plans", { method: "PATCH", body: JSON.stringify({ id: plan.id, status }) }),
    onSuccess: (_d, status) => {
      toast.success(status === "TAUGHT" ? "Marked as taught" : "Marked as skipped");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => api(`/api/lesson-plans?id=${plan.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Lesson plan deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className={cn("gap-3 py-4", muted && "opacity-85")}>
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="px-2 text-[11px] font-medium">{plan.className}</Badge>
            <span className="text-[11.5px] text-muted-foreground">{plan.subjectName}</span>
          </div>
          {statusBadge(plan.status)}
        </div>

        <div className="mt-2.5 text-[14px] font-semibold leading-snug">{plan.topic}</div>
        {plan.objectives && (
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{plan.objectives}</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          <span>{fmtDayDate(plan.date)}</span>
          <span className="tnum">· {plan.periods} period{plan.periods === 1 ? "" : "s"}</span>
          {plan.materials && (
            <span className="inline-flex items-center gap-1 truncate">
              <Package className="h-3 w-3 shrink-0" /> {plan.materials}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-1.5 border-t pt-3">
          {plan.status === "DRAFT" ? (
            <>
              <Button
                size="sm" variant="outline"
                className="h-7 border-success/30 text-success hover:bg-success/10 hover:text-success"
                onClick={() => mark.mutate("TAUGHT")} disabled={mark.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Taught
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-7"
                onClick={() => mark.mutate("SKIPPED")} disabled={mark.isPending}
              >
                <SkipForward className="h-3.5 w-3.5" /> Skipped
              </Button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" /> Closed on {fmtDayDate(plan.date)}
            </span>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="ml-auto h-7 w-7 px-0 text-muted-foreground hover:text-destructive" aria-label="Delete plan">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this lesson plan?</AlertDialogTitle>
                <AlertDialogDescription>
                  “{plan.topic}” for {plan.className} {plan.subjectName} will be removed permanently.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => del.mutate()} disabled={del.isPending}
                >
                  Delete plan
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── new plan dialog ─────────────────────────────────────────── */

function NewPlanDialog({
  open, onOpenChange, classes,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; classes: MyClass[];
}) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [objectives, setObjectives] = useState("");
  const [materials, setMaterials] = useState("");
  const [date, setDate] = useState(todayISO());
  const [periods, setPeriods] = useState(1);

  const klass = classes.find((c) => c.id === classId);
  const subjects = klass?.subjects ?? [];

  const create = useMutation({
    mutationFn: (body: object) => api("/api/lesson-plans", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success(`Lesson plan created for ${klass?.name} ${subjects.find((s) => s.id === subjectId)?.name ?? ""}`.trim());
      onOpenChange(false);
      setClassId(""); setSubjectId(""); setTopic(""); setObjectives(""); setMaterials(""); setPeriods(1);
      qc.invalidateQueries({ queryKey: ["lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!classId) return toast.error("Pick a class you teach.");
    if (!subjectId) return toast.error("Pick a subject.");
    if (!topic.trim()) return toast.error("Give the lesson a topic.");
    if (!date) return toast.error("Pick the lesson date.");
    create.mutate({
      classId, subjectId, topic: topic.trim(),
      objectives: objectives.trim() || undefined,
      materials: materials.trim() || undefined,
      date, periods,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lesson plan</DialogTitle>
          <DialogDescription>Classes and subjects you teach — plan a topic for a specific date.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={classId} onValueChange={(v) => { setClassId(v); setSubjectId(""); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Pick class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId} disabled={!classId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={classId ? "Pick subject" : "Pick class first"} />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-topic">Topic</Label>
            <Input id="plan-topic" placeholder="e.g. Quadratic equations — word problems" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-objectives">Objectives</Label>
            <Textarea
              id="plan-objectives" rows={3}
              placeholder="What students should be able to do by the end of the period…"
              value={objectives} onChange={(e) => setObjectives(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-materials">Materials</Label>
              <Input id="plan-materials" placeholder="Board, NCERT textbook…" value={materials} onChange={(e) => setMaterials(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-date">Date</Label>
              <Input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Periods</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button" variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setPeriods((p) => Math.max(1, p - 1))} aria-label="Fewer periods"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="tnum w-14 text-center text-sm font-medium">{periods} period{periods === 1 ? "" : "s"}</span>
              <Button
                type="button" variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setPeriods((p) => Math.min(3, p + 1))} aria-label="More periods"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[11.5px] text-muted-foreground">1–3 periods</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending || !subjectId}>
            {create.isPending ? "Creating…" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
