"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModuleCtx } from "@/lib/types";
import {
  PageHeader, SectionCard, StatCard, EmptyState, ErrorState, LoadingRows,
} from "@/components/modules/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { DAYS_FULL, DAYS_SHORT } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CalendarX2, Grid3x3, Pencil, Plus, Trash2, Users,
} from "lucide-react";

/* ── payload types (server contract) ─────────────────────────── */

interface Slot {
  id: string; dayOfWeek: number; period: number;
  subjectId: string; subjectCode: string; subjectName: string;
  teacherId: string; teacherName: string;
  roomId: string | null; roomCode: string | null;
  classId?: string; className?: string;
}
interface SubjectRef { id: string; code: string; name: string }
interface TeacherRef { id: string; name: string; subjectIds: string[] }
interface RoomRef { id: string; code: string; name: string }
interface ClassMeta { id: string; name: string; gradeLevel: number; subjectsCount: number }

interface ClassPayload {
  class: { id: string; name: string };
  slots: Slot[];
  subjects: SubjectRef[];
  teachers: TeacherRef[];
  rooms: RoomRef[];
}

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
const DAYS = [1, 2, 3, 4, 5, 6];
const isPrePrimary = (name: string) => /^(Nursery|LKG|IKG)/i.test(name);

/* ── module root ─────────────────────────────────────────────── */

export function TimetableModule({ ctx }: { ctx: ModuleCtx }) {
  if (ctx.me.role === "PRINCIPAL") return <PrincipalTimetable />;
  if (ctx.me.role === "TEACHER") return <TeacherTimetable />;
  return <StudentTimetable />;
}

/* ════════════════════════ shared grid ════════════════════════ */

interface Cell {
  subjectCode?: string; subjectName?: string; teacherName?: string;
  roomCode?: string; className?: string;
}

function WeekGrid({
  cells, mode, editable, onCellClick,
}: {
  cells: Record<string, Cell>;
  mode: "class" | "teacher";
  editable?: boolean;
  onCellClick?: (day: number, period: number) => void;
}) {
  const todayDow = new Date().getDay(); // 0 Sun … 6 Sat

  return (
    <div className="overflow-x-auto rounded-xl border scroll-slim">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="w-16 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Period
            </th>
            {DAYS.map((d) => (
              <th
                key={d}
                className={cn(
                  "px-2 py-2 text-center text-[12px] font-medium",
                  d === todayDow && "bg-primary/5 text-primary",
                )}
              >
                {DAYS_SHORT[d]}
                {d === todayDow && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide">today</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((p) => (
            <tr key={p} className="border-b last:border-0">
              <td className="tnum bg-muted/25 px-2 py-1 text-center text-[11.5px] font-semibold text-muted-foreground">
                P{p}
              </td>
              {DAYS.map((d) => {
                if (d === 6 && p === 5) {
                  return (
                    <td key={d} rowSpan={4} className="bg-muted/15 p-0">
                      <div className="flex h-full flex-col items-center justify-center gap-0.5 px-2 py-6 text-center">
                        <CalendarX2 className="h-4 w-4 text-muted-foreground/40" />
                        <div className="text-[11.5px] font-medium text-muted-foreground">Half day</div>
                        <div className="text-[10.5px] text-muted-foreground/60">School closes after P4</div>
                      </div>
                    </td>
                  );
                }
                if (d === 6 && p > 5) return null;
                const cell = cells[`${d}-${p}`];
                return (
                  <td key={d} className={cn("border-l p-1.5 align-top", d === todayDow && "bg-primary/[0.03]")}>
                    {editable ? (
                      <button
                        type="button"
                        onClick={() => onCellClick?.(d, p)}
                        aria-label={`Edit ${DAYS_FULL[d]} period ${p}`}
                        className={cn(
                          "group flex min-h-[64px] w-full flex-col justify-center rounded-lg px-2 py-1.5 text-left transition-all",
                          cell ? "bg-muted/40 hover:ring-1 hover:ring-primary/40" : "hover:bg-muted/30 hover:ring-1 hover:ring-primary/25",
                        )}
                      >
                        <CellBody cell={cell} mode={mode} editable />
                      </button>
                    ) : cell ? (
                      <div className="flex min-h-[64px] flex-col justify-center rounded-lg bg-muted/30 px-2 py-1.5">
                        <CellBody cell={cell} mode={mode} />
                      </div>
                    ) : (
                      <div className="flex min-h-[64px] items-center justify-center rounded-lg">
                        <span className="text-[11px] text-muted-foreground/30">—</span>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellBody({ cell, mode, editable }: { cell?: Cell; mode: "class" | "teacher"; editable?: boolean }) {
  if (!cell) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/40 group-hover:text-primary/70">
        {editable ? <><Plus className="h-3 w-3" /> Assign</> : "—"}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {mode === "class" ? (
        <>
          <div className="flex items-center gap-1.5">
            <Badge className="bg-primary/10 px-1.5 text-[10px] font-semibold tracking-wide text-primary hover:bg-primary/10">
              {cell.subjectCode}
            </Badge>
            <span className="truncate text-[12px] font-medium leading-tight">{cell.subjectName}</span>
          </div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{cell.teacherName}</div>
          {cell.roomCode && (
            <div className="truncate text-[10.5px] leading-tight text-muted-foreground/65">{cell.roomCode}</div>
          )}
        </>
      ) : (
        <>
          <div className="truncate text-[12px] font-medium leading-tight">{cell.className}</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{cell.subjectName}</div>
        </>
      )}
    </div>
  );
}

/* ════════════════════════ PRINCIPAL ════════════════════════ */

function PrincipalTimetable() {
  const metaQ = useQuery({
    queryKey: ["timetable", "meta"],
    queryFn: () => api<{ classes: ClassMeta[]; rooms: RoomRef[] }>("/api/timetable"),
  });
  const [classId, setClassId] = useState("");
  const [edit, setEdit] = useState<{ day: number; period: number } | null>(null);

  const meta = metaQ.data?.classes ?? [];
  // first class with subjects (pre-primary has none) until the principal picks one
  const effectiveClassId = classId || meta.find((c) => c.subjectsCount > 0)?.id || "";

  const classQ = useQuery({
    queryKey: ["timetable", "class", effectiveClassId],
    queryFn: () => api<ClassPayload>(`/api/timetable?classId=${effectiveClassId}`),
    enabled: !!effectiveClassId,
  });

  const selected = meta.find((c) => c.id === effectiveClassId);
  const data = classQ.data;

  const cells: Record<string, Cell> = {};
  for (const s of data?.slots ?? []) {
    cells[`${s.dayOfWeek}-${s.period}`] = {
      subjectCode: s.subjectCode, subjectName: s.subjectName,
      teacherName: s.teacherName, roomCode: s.roomCode,
    };
  }

  const existing = edit
    ? (data?.slots ?? []).find((s) => s.dayOfWeek === edit.day && s.period === edit.period)
    : undefined;

  if (metaQ.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Timetable" subtitle="Weekly grid per class — Monday to Saturday" />
        <LoadingRows rows={10} />
      </div>
    );
  }
  if (metaQ.isError || !metaQ.data) {
    return <ErrorState message={(metaQ.error as Error)?.message ?? "Could not load the timetable."} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        subtitle="Click any cell to assign a subject, teacher and room — conflicts are caught before saving"
        actions={
          <div className="w-44">
            <Select value={effectiveClassId} onValueChange={setClassId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick class" /></SelectTrigger>
              <SelectContent>
                {meta.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {selected && isPrePrimary(selected.name) && (data?.subjects.length ?? 0) === 0 ? (
        <EmptyState
          icon={Grid3x3}
          title="No formal timetable for pre-primary sections"
          hint={`${selected.name} follows a play-based daily rhythm — Nursery, LKG and IKG don't have period-wise subject grids.`}
        />
      ) : classQ.isLoading ? (
        <LoadingRows rows={10} />
      ) : classQ.isError ? (
        <ErrorState message={(classQ.error as Error)?.message ?? "Could not load this class's timetable."} />
      ) : (
        <SectionCard
          title={data?.class.name ?? ""}
          description={`${data?.slots.length ?? 0} periods scheduled · Mon–Sat (Saturday is a half day)`}
          contentClassName="pt-0"
        >
          <WeekGrid cells={cells} mode="class" editable onCellClick={(day, period) => setEdit({ day, period })} />
          <p className="mt-3 text-[12px] text-muted-foreground">
            Teachers shown first are the ones already assigned to the chosen subject in some class; picking anyone else is still allowed.
          </p>
        </SectionCard>
      )}

      {edit && data && (
        <SlotDialog
          key={`${edit.day}-${edit.period}`}
          classId={effectiveClassId}
          className_={data.class.name}
          day={edit.day}
          period={edit.period}
          existing={existing}
          subjects={data.subjects}
          teachers={data.teachers}
          rooms={data.rooms}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function SlotDialog({
  classId, className_, day, period, existing, subjects, teachers, rooms, onClose,
}: {
  classId: string; className_: string; day: number; period: number;
  existing?: Slot; subjects: SubjectRef[]; teachers: TeacherRef[]; rooms: RoomRef[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState(existing?.teacherId ?? "");
  const [roomId, setRoomId] = useState(existing?.roomId ?? "__none__");

  const qualified = teachers.filter((t) => subjectId && t.subjectIds.includes(subjectId));
  const others = teachers.filter((t) => subjectId && !t.subjectIds.includes(subjectId));
  const subjectName = subjects.find((s) => s.id === subjectId)?.name;

  const onSubjectChange = (v: string) => {
    setSubjectId(v);
    const firstQualified = teachers.find((t) => t.subjectIds.includes(v));
    if (firstQualified && (!teacherId || !teachers.find((t) => t.id === teacherId)?.subjectIds.includes(v))) {
      setTeacherId(firstQualified.id);
    }
  };

  const save = useMutation({
    mutationFn: (body: object) => api("/api/timetable", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success(`Period ${period} on ${DAYS_FULL[day]} updated for ${className_}`);
      qc.invalidateQueries({ queryKey: ["timetable"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message), // 409 conflict message arrives verbatim
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/timetable?slotId=${existing!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Period ${period} on ${DAYS_FULL[day]} cleared for ${className_}`);
      qc.invalidateQueries({ queryKey: ["timetable"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!subjectId) return toast.error("Pick a subject for this period.");
    if (!teacherId) return toast.error("Pick a teacher — their other commitments are checked automatically.");
    save.mutate({
      classId, dayOfWeek: day, period, subjectId, teacherId,
      roomId: roomId === "__none__" ? null : roomId,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{DAYS_FULL[day]} · Period {period}</DialogTitle>
          <DialogDescription>
            {existing
              ? `Currently ${existing.subjectName} with ${existing.teacherName}${existing.roomCode ? ` in ${existing.roomCode}` : ""}.`
              : `Free period for ${className_}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Select value={subjectId} onValueChange={onSubjectChange}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick subject" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Teacher</Label>
            <Select value={teacherId} onValueChange={setTeacherId} disabled={!subjectId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={subjectId ? "Pick teacher" : "Pick a subject first"} />
              </SelectTrigger>
              <SelectContent>
                {qualified.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Teaches {subjectName}</SelectLabel>
                    {qualified.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {others.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Other teachers</SelectLabel>
                    {others.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Room (optional)</Label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="No room" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No room</SelectItem>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.code} · {r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {existing ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Clear period
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear this period?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {existing.subjectName} with {existing.teacherName} will be removed from {className_}’s {DAYS_FULL[day]} P{period}.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate()} disabled={remove.isPending}>
                    Clear period
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending}>
              <Pencil className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : existing ? "Update period" : "Assign period"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════ TEACHER ════════════════════════ */

function TeacherTimetable() {
  const q = useQuery({
    queryKey: ["timetable", "mine"],
    queryFn: () => api<{ slots: Slot[] }>("/api/timetable"),
  });

  const cells: Record<string, Cell> = {};
  for (const s of q.data?.slots ?? []) {
    cells[`${s.dayOfWeek}-${s.period}`] = {
      className: s.className, subjectCode: s.subjectCode, subjectName: s.subjectName,
    };
  }

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Timetable" subtitle="Your teaching week" />
        <LoadingRows rows={10} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load your timetable."} />;

  const slots = q.data.slots;
  const uniqueClasses = new Set(slots.map((s) => s.className));
  const byDay = new Map<number, number>();
  for (const s of slots) byDay.set(s.dayOfWeek, (byDay.get(s.dayOfWeek) ?? 0) + 1);
  let busiest: { day: number; n: number } | null = null;
  for (const [day, n] of byDay) if (!busiest || n > busiest.n) busiest = { day, n };

  if (slots.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Timetable" subtitle="Your teaching week" />
        <EmptyState
          icon={Grid3x3}
          title="No periods on your timetable yet"
          hint="The office hasn’t scheduled you for any class periods. This page fills in as slots are assigned."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        subtitle={`Your teaching week · ${slots.length} periods across ${uniqueClasses.size} class${uniqueClasses.size === 1 ? "" : "es"}`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Weekly load" value={`${slots.length} periods`} sub="Mon–Sat, Saturday half day" icon={Grid3x3} tone="primary" />
        <StatCard label="Classes" value={uniqueClasses.size} sub={[...uniqueClasses].slice(0, 3).join(", ") + (uniqueClasses.size > 3 ? "…" : "")} icon={Users} />
        <StatCard
          label="Busiest day"
          value={busiest ? DAYS_SHORT[busiest.day] : "—"}
          sub={busiest ? `${busiest.n} periods` : ""}
          icon={CalendarX2}
        />
      </div>

      <SectionCard title="My week" description="Where you are expected, period by period" contentClassName="pt-0">
        <WeekGrid cells={cells} mode="teacher" />
      </SectionCard>
    </div>
  );
}

/* ════════════════════════ STUDENT ════════════════════════ */

function StudentTimetable() {
  const q = useQuery({
    queryKey: ["timetable", "class"],
    queryFn: () => api<{ class: { id: string; name: string }; slots: Slot[] }>("/api/timetable"),
  });

  const cells: Record<string, Cell> = {};
  for (const s of q.data?.slots ?? []) {
    cells[`${s.dayOfWeek}-${s.period}`] = {
      subjectCode: s.subjectCode, subjectName: s.subjectName,
      teacherName: s.teacherName, roomCode: s.roomCode,
    };
  }

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Timetable" subtitle="Your class schedule" />
        <LoadingRows rows={10} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load your timetable."} />;

  const { class: klass, slots } = q.data;

  if (slots.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Timetable" subtitle={`${klass.name} · Monday to Saturday`} />
        <EmptyState
          icon={Grid3x3}
          title={isPrePrimary(klass.name) ? "No formal timetable for pre-primary sections" : "No timetable published yet"}
          hint={isPrePrimary(klass.name)
            ? "Nursery, LKG and IKG follow a play-based daily rhythm with activity blocks instead of subject periods."
            : "Your class’s period grid hasn’t been scheduled yet. Check back soon."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        subtitle={`${klass.name} · ${slots.length} periods a week · Saturday is a half day`}
      />
      <SectionCard title="My week" description="Subject, teacher and room for every period" contentClassName="pt-0">
        <WeekGrid cells={cells} mode="class" />
      </SectionCard>
    </div>
  );
}
