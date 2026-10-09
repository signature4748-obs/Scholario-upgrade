"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid, StatusDot } from "@/components/modules/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  CalendarCheck, CheckCircle2, Users, UserCheck, UserX, Clock3, PlaneTakeoff, Loader2,
  CalendarDays, CheckCheck, Info, DoorOpen,
} from "lucide-react";
import { fmtDayDate, initials, avatarTint } from "@/lib/format";
import { cn } from "@/lib/utils";

const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function AttendanceModule({ ctx }: { ctx: ModuleCtx }) {
  if (ctx.me.role === "TEACHER") return <TeacherAttendance ctx={ctx} />;
  if (ctx.me.role === "PRINCIPAL") return <PrincipalAttendance ctx={ctx} />;
  return <StudentAttendance ctx={ctx} />;
}

/* ════════════════════════ TEACHER ════════════════════════ */

interface RosterStudent { id: string; rollNo: number; name: string; admissionNo: string; status: string | null }
interface TeacherAttendanceData {
  role: "TEACHER";
  date: string;
  myClasses: { id: string; name: string; strength: number; markedCount: number }[];
  classesTaught: { id: string; name: string }[];
  roster?: {
    classId: string; className: string; isClassTeacher: boolean; students: RosterStudent[];
  };
}

function TeacherAttendance({ ctx }: { ctx: ModuleCtx }) {
  const [date, setDate] = useState(todayIso());
  const [pickedClassId, setPickedClassId] = useState("");

  // meta (home classes + classes taught) — no roster until a class is in play
  const metaQ = useQuery({
    queryKey: ["attendance", "meta", date],
    queryFn: () => api<TeacherAttendanceData>(`/api/attendance?date=${date}`),
  });
  const meta = metaQ.data;
  const myClasses = meta?.myClasses ?? [];

  // derive the effective class during render — first home class until the teacher picks one
  const classId = pickedClassId || myClasses[0]?.id || "";

  const rosterQ = useQuery({
    queryKey: ["attendance", "roster", date, classId],
    queryFn: () => api<TeacherAttendanceData>(`/api/attendance?date=${date}&classId=${classId}`),
    enabled: !!classId,
  });
  const roster = rosterQ.data?.roster;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        subtitle={
          roster
            ? `${roster.className} · ${fmtDayDate(date)}${roster.isClassTeacher ? " · you are the class teacher" : " · view only — the class teacher submits"}`
            : `${ctx.me.school.shortName ?? ctx.me.school.name} · ${fmtDayDate(date)}`
        }
        actions={
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Attendance date"
              className="tnum h-9 w-[150px]"
            />
          </div>
        }
      />

      {metaQ.isLoading ? (
        <LoadingRows rows={8} />
      ) : metaQ.isError ? (
        <ErrorState message={(metaQ.error as Error)?.message ?? "Couldn't load attendance."} />
      ) : !meta ? null : myClasses.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="You're not a class teacher this session"
          hint={
            meta.classesTaught.length > 0
              ? "Daily attendance is submitted by each section's class teacher. You teach in these classes:"
              : "Daily attendance is submitted by each section's class teacher. Once you're assigned a home room, it appears here."
          }
          action={
            meta.classesTaught.length > 0 ? (
              <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                {meta.classesTaught.map((c) => (
                  <Badge key={c.id} variant="secondary" className="bg-muted text-[11.5px]">{c.name}</Badge>
                ))}
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* home classes */}
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={classId} onValueChange={setPickedClassId}>
              <TabsList>
                {myClasses.map((c) => (
                  <TabsTrigger key={c.id} value={c.id} className="gap-1.5 text-[12.5px]">
                    {c.name}
                    {c.markedCount > 0 ? (
                      <CheckCircle2 className="h-3 w-3 text-success" aria-label="marked" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="pending" />
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {meta.classesTaught.length > 0 && (
              <span className="tnum text-[11.5px] text-muted-foreground">
                + you teach in {meta.classesTaught.length} classes
              </span>
            )}
          </div>

          {rosterQ.isError ? (
            <ErrorState message={(rosterQ.error as Error)?.message ?? "Couldn't load this roster."} />
          ) : roster ? (
            <RosterCard key={`${roster.classId}-${date}`} roster={roster} date={date} />
          ) : (
            <LoadingRows rows={6} />
          )}
        </>
      )}
    </div>
  );
}

/* ── roster grid with P/A/L/L toggles ───────────────────────────── */

const STATUS_OPTS: { key: "PRESENT" | "ABSENT" | "LATE" | "LEAVE"; short: string; label: string; on: string }[] = [
  { key: "PRESENT", short: "P", label: "Present", on: "bg-success/15 text-success" },
  { key: "ABSENT", short: "A", label: "Absent", on: "bg-destructive/15 text-destructive" },
  { key: "LATE", short: "L", label: "Late", on: "bg-warning/20 text-warning-foreground dark:text-warning" },
  { key: "LEAVE", short: "Lv", label: "Leave", on: "bg-info/15 text-info" },
];

function RosterCard({
  roster, date,
}: {
  roster: NonNullable<TeacherAttendanceData["roster"]>;
  date: string;
}) {
  const qc = useQueryClient();
  const [marks, setMarks] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(roster.students.map((s) => [s.id, s.status])),
  );

  const initial = useMemo(
    () => Object.fromEntries(roster.students.map((s) => [s.id, s.status] as const)),
    [roster],
  );
  const dirtyCount = roster.students.filter((s) => (marks[s.id] ?? null) !== (initial[s.id] ?? null)).length;
  const unmarked = roster.students.filter((s) => !marks[s.id]).length;
  const allMarkedInitially = roster.students.every((s) => !!s.status);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0, NONE: 0 };
    for (const s of roster.students) {
      const m = marks[s.id];
      if (m) c[m as keyof typeof c]++;
      else c.NONE++;
    }
    return c;
  }, [marks, roster.students]);

  const submit = useMutation({
    mutationFn: () =>
      api<{ className: string; count: number }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          classId: roster.classId,
          date,
          entries: roster.students
            .filter((s) => marks[s.id])
            .map((s) => ({ studentId: s.id, status: marks[s.id] })),
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Attendance submitted for ${d.className}`);
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSubmit = () => {
    if (unmarked > 0) {
      toast.error(`Mark everyone first — ${unmarked} student${unmarked > 1 ? "s" : ""} still unmarked`);
      return;
    }
    submit.mutate();
  };

  const setAllPresent = () =>
    setMarks(Object.fromEntries(roster.students.map((s) => [s.id, "PRESENT"])));

  const canSubmit = roster.isClassTeacher && dirtyCount > 0 && unmarked === 0 && !submit.isPending;

  return (
    <SectionCard
      title={roster.className}
      description={`${roster.students.length} students · ${fmtDayDate(date)}`}
      contentClassName="px-0"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {dirtyCount > 0 && (
            <span className="tnum flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[11.5px] font-medium text-warning-foreground dark:text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              {dirtyCount} unsaved change{dirtyCount > 1 ? "s" : ""}
            </span>
          )}
          {allMarkedInitially && dirtyCount === 0 && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <CheckCheck className="h-3.5 w-3.5 text-success" /> already marked
            </span>
          )}
          <Button variant="outline" size="sm" onClick={setAllPresent} disabled={!roster.isClassTeacher}>
            <Users className="h-3.5 w-3.5" /> All present
          </Button>
          {roster.isClassTeacher ? (
            <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
              {submit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Submit
            </Button>
          ) : (
            <Badge variant="secondary" className="bg-muted text-[11.5px] font-normal">
              <Info className="h-3 w-3" /> view only
            </Badge>
          )}
        </div>
      }
    >
      {/* live tally */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-2.5 text-[12.5px]">
        {counts.PRESENT > 0 && <span className="tnum"><StatusDot status="PRESENT" /> <span className="font-medium">{counts.PRESENT}</span></span>}
        {counts.ABSENT > 0 && <span className="tnum"><StatusDot status="ABSENT" /> <span className="font-medium">{counts.ABSENT}</span></span>}
        {counts.LATE > 0 && <span className="tnum"><StatusDot status="LATE" /> <span className="font-medium">{counts.LATE}</span></span>}
        {counts.LEAVE > 0 && <span className="tnum"><StatusDot status="LEAVE" /> <span className="font-medium">{counts.LEAVE}</span></span>}
        {counts.NONE > 0 && <span className="tnum text-muted-foreground">{counts.NONE} unmarked</span>}
        {allMarkedInitially && (
          <span className="ml-auto hidden items-center gap-1.5 text-[11.5px] text-muted-foreground sm:flex">
            <Info className="h-3 w-3" /> corrections update the saved record
          </span>
        )}
      </div>

      <div className="max-h-[520px] divide-y overflow-y-auto scroll-slim">
        {roster.students.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-2 px-4 py-2.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="tnum w-6 shrink-0 text-[12.5px] text-muted-foreground">{s.rollNo}</span>
            <span
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-foreground/70 sm:flex"
              style={{ background: avatarTint(s.name) }}
            >
              {initials(s.name)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13.5px] font-medium">{s.name}</div>
              <div className="tnum text-[11.5px] text-muted-foreground">{s.admissionNo}</div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/25 p-0.5" role="group" aria-label={`Mark ${s.name}`}>
              {STATUS_OPTS.map((o) => {
                const on = marks[s.id] === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${o.label} — ${s.name}`}
                    title={o.label}
                    onClick={() => setMarks((m) => ({ ...m, [s.id]: on ? null : o.key }))}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-[11.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                      on ? o.on : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="sm:hidden">{o.short}</span>
                    <span className="hidden sm:inline">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {roster.isClassTeacher && unmarked > 0 && (
        <p className="border-t px-4 py-2 text-[11.5px] text-muted-foreground">
          Tap a status for every student, or use “All present” for a quick full house.
        </p>
      )}
    </SectionCard>
  );
}

/* ════════════════════════ PRINCIPAL ════════════════════════ */

interface PrincipalAttendanceData {
  role: "PRINCIPAL";
  date: string;
  overall: { present: number; absent: number; late: number; leave: number; pct: number | null; classesMarked: number; classesTotal: number };
  classes: {
    id: string; name: string; classTeacher: string | null; strength: number;
    present: number; absent: number; late: number; leave: number; marked: boolean; pct: number | null;
  }[];
  trend: { date: string; pct: number | null }[];
}

function PrincipalAttendance({ ctx }: { ctx: ModuleCtx }) {
  const [date, setDate] = useState(todayIso());
  const q = useQuery({
    queryKey: ["attendance", { date, role: "PRINCIPAL" }],
    queryFn: () => api<PrincipalAttendanceData>(`/api/attendance?date=${date}`),
  });

  const data = q.data;
  const trend = useMemo(
    () =>
      (data?.trend ?? []).map((t) => ({
        day: fmtDayDate(t.date).replace(", ", " "),
        pct: t.pct,
      })),
    [data],
  );
  const chartConfig = { pct: { label: "Attendance %", color: "var(--primary)" } } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        subtitle={`${ctx.me.school.shortName ?? ctx.me.school.name} · ${fmtDayDate(date)}`}
        actions={
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Attendance date"
              className="tnum h-9 w-[150px]"
            />
          </div>
        }
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <LoadingGrid count={4} />
          <LoadingRows rows={10} />
        </div>
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message ?? "Couldn't load attendance."} />
      ) : !data ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="School attendance"
              value={data.overall.pct != null ? `${data.overall.pct}%` : "—"}
              sub={`${data.overall.classesMarked}/${data.overall.classesTotal} sections marked`}
              icon={CalendarCheck}
              tone={data.overall.pct == null ? "warning" : data.overall.pct >= 90 ? "success" : data.overall.pct >= 80 ? "warning" : "destructive"}
            />
            <StatCard label="Present" value={data.overall.present} sub="in class today" icon={UserCheck} tone="success" />
            <StatCard label="Absent" value={data.overall.absent} sub="across marked sections" icon={UserX} tone="destructive" />
            <StatCard
              label="Late & on leave"
              value={data.overall.late + data.overall.leave}
              sub={`${data.overall.late} late · ${data.overall.leave} on leave`}
              icon={Clock3}
              tone="info"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <SectionCard
              title="Class-wise attendance"
              description="Late and leave count towards presence"
              className="lg:col-span-3"
              contentClassName="px-0"
            >
              <div className="max-h-[460px] overflow-y-auto scroll-slim">
                <Table className="min-w-[560px]">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 pl-4 text-[11.5px] uppercase tracking-wide text-muted-foreground">Class</TableHead>
                      <TableHead className="hidden text-[11.5px] uppercase tracking-wide text-muted-foreground md:table-cell">Teacher</TableHead>
                      <TableHead className="text-right text-[11.5px] uppercase tracking-wide text-muted-foreground">P</TableHead>
                      <TableHead className="text-right text-[11.5px] uppercase tracking-wide text-muted-foreground">A</TableHead>
                      <TableHead className="hidden text-right text-[11.5px] uppercase tracking-wide text-muted-foreground sm:table-cell">L</TableHead>
                      <TableHead className="hidden text-right text-[11.5px] uppercase tracking-wide text-muted-foreground sm:table-cell">Lv</TableHead>
                      <TableHead className="pr-4 text-right text-[11.5px] uppercase tracking-wide text-muted-foreground">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.classes.map((c) => (
                      <TableRow key={c.id} className={cn("hover:bg-muted/40", !c.marked && "text-muted-foreground/70")}>
                        <TableCell className="py-2.5 pl-4">
                          <div className="text-[13px] font-medium">{c.name}</div>
                          <div className="tnum text-[11px] text-muted-foreground">{c.strength} on roll</div>
                        </TableCell>
                        <TableCell className="hidden max-w-[150px] truncate text-[12.5px] text-muted-foreground md:table-cell">
                          {c.classTeacher ?? "—"}
                        </TableCell>
                        <TableCell className="tnum text-right text-[13px]">{c.marked ? c.present : "—"}</TableCell>
                        <TableCell className="tnum text-right text-[13px]">{c.marked ? c.absent : "—"}</TableCell>
                        <TableCell className="tnum hidden text-right text-[13px] sm:table-cell">{c.marked ? c.late : "—"}</TableCell>
                        <TableCell className="tnum hidden text-right text-[13px] sm:table-cell">{c.marked ? c.leave : "—"}</TableCell>
                        <TableCell className="pr-4">
                          {c.marked && c.pct != null ? (
                            <div className="flex items-center justify-end gap-2">
                              <Progress value={c.pct} className="hidden h-1.5 w-16 md:flex" />
                              <span className={cn("tnum w-11 text-right text-[13px] font-medium", c.pct >= 90 ? "text-success" : c.pct >= 75 ? "text-warning-foreground dark:text-warning" : "text-destructive")}>
                                {c.pct}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground/70">not marked</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <SectionCard
              title="10-day trend"
              description="School-wide presence, last 10 school days"
              className="lg:col-span-2"
            >
              {trend.every((t) => t.pct == null) ? (
                <EmptyState icon={CalendarCheck} title="Nothing marked yet" hint="Once sections start submitting attendance, the trend builds here." />
              ) : (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={trend} margin={{ left: -18, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 10.5 }} interval={0} angle={-35} textAnchor="end" height={44} />
                    <YAxis domain={[60, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v) => `${v}%`} />} />
                    <Bar dataKey="pct" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  </BarChart>
                </ChartContainer>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

/* ════════════════════════ STUDENT ════════════════════════ */

interface StudentAttendanceData {
  role: "STUDENT";
  className: string | null;
  days: { date: string; status: string }[];
  counts: Record<string, number>;
  considered: number;
  pct: number | null;
}

function StudentAttendance({ ctx }: { ctx: ModuleCtx }) {
  const q = useQuery({
    queryKey: ["attendance", { role: "STUDENT" }],
    queryFn: () => api<StudentAttendanceData>("/api/attendance"),
  });

  const data = q.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="My attendance"
        subtitle={`${ctx.me.name} · ${data?.className ?? "…"} · last ${data?.considered ?? 0} school days`}
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <LoadingGrid count={4} />
          <LoadingRows rows={8} />
        </div>
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message ?? "Couldn't load your attendance."} />
      ) : !data ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Overall attendance"
              value={data.pct != null ? `${data.pct}%` : "—"}
              sub={data.pct != null && data.pct < 75 ? "below the 75% exam eligibility line" : "healthy, keep it up"}
              icon={CalendarCheck}
              tone={data.pct == null ? "warning" : data.pct >= 90 ? "success" : data.pct >= 75 ? "warning" : "destructive"}
            />
            <StatCard label="Present" value={data.counts.PRESENT ?? 0} sub="full days in class" icon={UserCheck} tone="success" />
            <StatCard label="Absent" value={data.counts.ABSENT ?? 0} sub="missed days" icon={UserX} tone="destructive" />
            <StatCard label="Late arrivals" value={data.counts.LATE ?? 0} sub="counted as present" icon={Clock3} tone="warning" />
            <StatCard label="On leave" value={data.counts.LEAVE ?? 0} sub="approved absences" icon={PlaneTakeoff} tone="info" />
          </div>

          <SectionCard
            title="Day-wise record"
            description="Newest first — the last 60 school days"
            contentClassName="px-0"
          >
            {data.days.length === 0 ? (
              <EmptyState icon={CalendarCheck} title="No attendance yet" hint="Your record appears once your class teacher starts marking the register." />
            ) : (
              <div className="max-h-[480px] divide-y overflow-y-auto scroll-slim">
                {data.days.map((d) => (
                  <div key={d.date} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/30">
                    <span className="text-[13px] font-medium">{fmtDayDate(d.date)}</span>
                    <StatusDot status={d.status} />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
