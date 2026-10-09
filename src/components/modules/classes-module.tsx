"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { PageHeader, StatCard, EmptyState, ErrorState, LoadingGrid, LoadingRows } from "@/components/modules/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Layers, UserPlus, Users, DoorOpen, Loader2, Pencil, GraduationCap, BookOpenCheck,
} from "lucide-react";
import { initials, avatarTint } from "@/lib/format";
import { cn } from "@/lib/utils";

/* gradeLevel → label (matches the seeded levels: 1=Nursery … 15=Class 12) */
const LEVELS: { value: number; label: string }[] = [
  { value: 1, label: "Nursery" },
  { value: 2, label: "LKG" },
  { value: 3, label: "IKG" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 4, label: `Class ${i + 1}` })),
];

interface SubjectChip { code: string; name: string; teacher: string | null }
interface ClassCard {
  id: string; name: string; gradeLevel: number; section: string; stream: string | null;
  capacity: number; strength: number; classTeacherId: string | null; classTeacher: string | null;
  room: string | null; subjects: SubjectChip[];
}
interface ClassesData { rooms: { id: string; name: string; code: string }[]; classes: ClassCard[] }
interface TeacherOption { id: string; name: string; employeeCode: string }

export function ClassesModule({ ctx }: { ctx: ModuleCtx }) {
  const classesQ = useQuery({
    queryKey: ["classes"],
    queryFn: () => api<ClassesData>("/api/classes"),
  });
  const teachersQ = useQuery({
    queryKey: ["teachers", { q: "" }],
    queryFn: () => api<{ teachers: TeacherOption[] }>("/api/teachers"),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [editClass, setEditClass] = useState<ClassCard | null>(null);

  const classes = classesQ.data?.classes ?? [];
  const onRoll = useMemo(() => classes.reduce((t, c) => t + c.strength, 0), [classes]);
  const seats = useMemo(() => classes.reduce((t, c) => t + c.capacity, 0), [classes]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Classes & Sections"
        subtitle={`${classes.length} sections · Nursery to Class 12 · ${ctx.me.school.academicYear} session`}
        actions={
          <Button size="sm" onClick={() => { setAddKey((k) => k + 1); setAddOpen(true); }}>
            <UserPlus className="h-3.5 w-3.5" /> Add section
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sections" value={classes.length} sub="one section per level unless split" icon={Layers} tone="primary" />
        <StatCard label="Students on roll" value={onRoll} sub="active across all sections" icon={Users} />
        <StatCard
          label="Average fill"
          value={seats > 0 ? `${Math.round((onRoll / seats) * 100)}%` : "—"}
          sub={`${onRoll} of ${seats} seats occupied`}
          icon={DoorOpen}
        />
      </div>

      {classesQ.isLoading ? (
        <LoadingGrid count={6} />
      ) : classesQ.isError ? (
        <ErrorState message={(classesQ.error as Error)?.message ?? "Couldn't load classes."} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No sections yet"
          hint="Create your first section — a class teacher and subjects can be assigned right after."
          action={<Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Add section</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => {
            const fill = c.capacity > 0 ? Math.min(100, Math.round((c.strength / c.capacity) * 100)) : 0;
            return (
              <div key={c.id} className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-[15px] font-semibold leading-none">{c.name}</h3>
                      {c.stream && <Badge variant="secondary" className="h-5 bg-muted text-[10.5px]">{c.stream}</Badge>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <DoorOpen className="h-3 w-3" /> {c.room ?? "No room assigned"}
                    </div>
                  </div>
                  <span className="tnum text-[12px] text-muted-foreground">#{c.gradeLevel}</span>
                </div>

                {/* class teacher */}
                <div className="mt-3.5 flex items-center justify-between gap-2 rounded-lg border bg-muted/25 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-foreground/70"
                      style={{ background: c.classTeacher ? avatarTint(c.classTeacher) : "var(--muted)" }}
                    >
                      {c.classTeacher ? initials(c.classTeacher) : "—"}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Class teacher</div>
                      <div className="truncate text-[13px] font-medium">{c.classTeacher ?? "Not assigned"}</div>
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" aria-label={`Change class teacher of ${c.name}`}
                    onClick={() => setEditClass(c)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* strength */}
                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-muted-foreground">Strength</span>
                    <span className="tnum text-[13px] font-medium">
                      {c.strength}
                      <span className="text-muted-foreground/60">/{c.capacity}</span>
                    </span>
                  </div>
                  <Progress value={fill} className="mt-1.5 h-1.5" />
                </div>

                {/* subjects */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                      <BookOpenCheck className="h-3 w-3" /> Subjects · {c.subjects.length}
                    </span>
                  </div>
                  {c.subjects.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">Pre-primary — no formal subjects.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.subjects.map((s) => (
                        <span
                          key={s.code}
                          title={s.teacher ? `${s.name} — ${s.teacher}` : `${s.name} — no teacher assigned`}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
                            s.teacher ? "bg-card" : "border-warning/40 bg-warning/10",
                          )}
                        >
                          <span className="font-semibold">{s.code}</span>
                          <span className="max-w-[110px] truncate text-muted-foreground">{s.teacher ?? "unassigned"}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChangeTeacherDialog
        key={editClass?.id ?? "none"}
        cls={editClass}
        teachers={teachersQ.data?.teachers ?? []}
        teachersLoading={teachersQ.isLoading}
        onClose={() => setEditClass(null)}
      />
      <AddSectionDialog key={addKey} open={addOpen} onOpenChange={setAddOpen} rooms={classesQ.data?.rooms ?? []} />
    </div>
  );
}

/* ── change class teacher dialog ────────────────────────────────── */

function ChangeTeacherDialog({
  cls, teachers, teachersLoading, onClose,
}: {
  cls: ClassCard | null;
  teachers: TeacherOption[];
  teachersLoading: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // fresh mount per class (keyed by parent) — seed the current teacher directly
  const [teacherId, setTeacherId] = useState(cls?.classTeacherId ?? "");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ classTeacher: string }>(`/api/classes/${cls!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ classTeacherId: teacherId }),
      }),
    onSuccess: (d) => {
      toast.success(`${cls!.name} class teacher is now ${d.classTeacher}`);
      qc.invalidateQueries({ queryKey: ["classes"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={!!cls} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Class teacher — {cls?.name}</DialogTitle>
          <DialogDescription>
            The class teacher submits daily attendance and is the first contact for parents of this section.
          </DialogDescription>
        </DialogHeader>

        {teachersLoading ? (
          <LoadingRows rows={2} />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="ct-select">Teacher</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger id="ct-select" className="w-full">
                <SelectValue placeholder="Pick a teacher" />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · {t.employeeCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11.5px] text-muted-foreground">
              Currently {cls?.classTeacher ?? "not assigned"}. A teacher leading another section will hand it over.
            </p>
          </div>
        )}

        {error && <ErrorState message={error} />}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!teacherId || mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── add section dialog ─────────────────────────────────────────── */

function AddSectionDialog({
  open, onOpenChange, rooms,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rooms: { id: string; name: string; code: string }[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ gradeLevel: "", section: "", capacity: "40", roomId: "" });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ name: string }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({
          gradeLevel: Number(form.gradeLevel),
          section: form.section.trim().toUpperCase(),
          capacity: Number(form.capacity),
          roomId: form.roomId,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`${d.name} created — assign a class teacher next`);
      qc.invalidateQueries({ queryKey: ["classes"] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const label = LEVELS.find((l) => String(l.value) === form.gradeLevel)?.label;
  const preview = label ? `${label}-${form.section.trim().toUpperCase() || "?"}` : "Class —";
  const capacity = Number(form.capacity);
  const valid = !!form.gradeLevel && /^[A-Z]$/i.test(form.section.trim()) && capacity >= 5 && capacity <= 120 && !!form.roomId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a section</DialogTitle>
          <DialogDescription>
            Splits get their own home room — <span className="font-medium">{preview}</span>
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) {
              setError("Pick a level, a section letter, capacity 5–120 and a room.");
              return;
            }
            setError(null);
            create.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-level">Level</Label>
              <Select value={form.gradeLevel} onValueChange={(v) => setForm((f) => ({ ...f, gradeLevel: v }))}>
                <SelectTrigger id="c-level" className="w-full">
                  <SelectValue placeholder="Nursery…Class 12" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {LEVELS.map((l) => (
                    <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-section">Section</Label>
              <Input
                id="c-section" value={form.section} maxLength={1}
                onChange={(e) => setForm((f) => ({ ...f, section: e.target.value.toUpperCase() }))}
                placeholder="B"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-cap">Capacity</Label>
              <Input
                id="c-cap" type="number" min={5} max={120} value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-room">Room</Label>
              <Select value={form.roomId} onValueChange={(v) => setForm((f) => ({ ...f, roomId: v }))}>
                <SelectTrigger id="c-room" className="w-full">
                  <SelectValue placeholder="Pick a room" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
            Subjects and teachers carry over per level band — assign them from the curriculum after creating.
          </div>

          {error && <ErrorState message={error} />}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !valid}>
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create section
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
