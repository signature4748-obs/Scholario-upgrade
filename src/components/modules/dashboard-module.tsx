"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type ModuleCtx } from "@/lib/types";
import { PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingGrid, LoadingRows, StatusDot } from "@/components/modules/kit";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { inr, fmtDayDate, fmtDateTime, timeAgo, initials, avatarTint, DAYS_SHORT } from "@/lib/format";
import {
  Users, GraduationCap, CalendarCheck, Wallet, ReceiptIndianRupee, TrendingUp, Clock3,
  ClipboardCheck, Banknote, BookOpenCheck, Megaphone, Trophy, AlertTriangle, ArrowRight,
  Layers, PiggyBank, Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardModule({ ctx }: { ctx: ModuleCtx }) {
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<any>("/api/dashboard"),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <LoadingGrid count={4} />
        <LoadingRows rows={8} />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message ?? "Could not load the dashboard."} />;

  if (q.data.role === "PRINCIPAL") return <PrincipalDashboard data={q.data} ctx={ctx} />;
  if (q.data.role === "TEACHER") return <TeacherDashboard data={q.data} ctx={ctx} />;
  return <StudentDashboard data={q.data} ctx={ctx} />;
}

/* ════════════════════════ PRINCIPAL ════════════════════════ */

function PrincipalDashboard({ data, ctx }: { data: any; ctx: ModuleCtx }) {
  const k = data.kpis;
  const monthName = (key: string) => {
    const d = new Date(key + "-15T00:00:00");
    return d.toLocaleString("en-IN", { month: "short" });
  };
  const feeChart = Object.entries(k.collectedByMonth as Record<string, number>).map(([m, v]) => ({
    month: monthName(m),
    collected: v,
  }));
  const attChart = (data.attendanceTrend as any[]).map((t) => ({
    day: fmtDayDate(t.date).replace(/, /, " ").split(" ")[1] + " " + fmtDayDate(t.date).split(" ")[2],
    pct: t.pct ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${ctx.me.name.split(" ")[0]}`}
        subtitle={`${ctx.me.school.name} · ${ctx.me.school.board} · Session ${ctx.me.school.academicYear}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => ctx.go("notices")}>
            <Megaphone className="h-3.5 w-3.5" /> Post a notice
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Students on roll" value={k.students} sub={`${k.suspended} suspended · ${k.sections} sections`} icon={Users} tone="primary" />
        <StatCard label="Teaching staff" value={k.teachers} sub={`${k.rooms} rooms & labs`} icon={GraduationCap} />
        <StatCard
          label="Attendance today"
          value={k.attendanceToday != null ? `${k.attendanceToday}%` : "—"}
          sub={`${k.classesMarked}/${k.classesTotal} sections marked`}
          icon={CalendarCheck}
          tone={k.attendanceToday == null ? "warning" : k.attendanceToday >= 85 ? "success" : "warning"}
        />
        <StatCard
          label="Collected this session"
          value={inr(k.collectedThisSession, { compact: true })}
          sub={
            <>
              {inr(k.outstandingDues, { compact: true })} outstanding ·{" "}
              {k.underVerificationCount > 0 ? (
                <button className="underline decoration-dotted underline-offset-2" onClick={() => ctx.go("fees")}>
                  {k.underVerificationCount} to verify
                </button>
              ) : (
                "none pending verification"
              )}
            </>
          }
          icon={Wallet}
          tone="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Attendance trend" description="School-wide presence, last 10 school days" className="lg:col-span-3">
          <ChartContainer config={{ pct: { label: "Attendance %", color: "var(--primary)" } }} className="h-[220px] w-full">
            <AreaChart data={attChart} margin={{ left: -18, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="attFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis domain={[60, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Area dataKey="pct" type="monotone" stroke="var(--primary)" strokeWidth={2} fill="url(#attFill)" />
            </AreaChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard title="Fee collection" description="Receipts verified as received, by month" className="lg:col-span-2">
          <ChartContainer config={{ collected: { label: "Collected", color: "var(--primary)" } }} className="h-[220px] w-full">
            <BarChart data={feeChart} margin={{ left: -14, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => inr(v, { compact: true })} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v) => inr(Number(v))} />} />
              <Bar dataKey="collected" fill="var(--primary)" radius={[5, 5, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ChartContainer>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard
          title="Sections"
          description="Strength and today's attendance by class"
          className="lg:col-span-3"
          actions={
            <Button variant="ghost" size="sm" onClick={() => ctx.go("classes")}>
              All classes <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          <div className="max-h-[340px] space-y-1 overflow-y-auto scroll-slim pr-1">
            {(data.classes as any[]).map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                <div className="w-24 shrink-0 text-[13px] font-medium">{c.name}</div>
                <div className="w-36 shrink-0 truncate text-[12.5px] text-muted-foreground">{c.classTeacher}</div>
                <div className="tnum w-14 shrink-0 text-[13px]">
                  {c.strength}
                  <span className="text-muted-foreground/60">/{c.capacity}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {c.attendanceToday != null ? (
                    <div className="flex items-center gap-2">
                      <Progress value={c.attendanceToday} className="h-1.5 w-full" />
                      <span className="tnum w-9 text-right text-[12px] text-muted-foreground">{c.attendanceToday}%</span>
                    </div>
                  ) : (
                    <span className="text-[12px] text-muted-foreground/60">not marked yet</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="space-y-4 lg:col-span-2">
          {data.pa1 && (
            <SectionCard title={data.pa1.name} description="Class averages, best six">
              <div className="space-y-2.5">
                {(data.pa1.averages as any[]).map((a) => (
                  <div key={a.className} className="flex items-center gap-2.5">
                    <div className="w-20 shrink-0 text-[12.5px] font-medium">{a.className}</div>
                    <div className="flex-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", a.pct >= 70 ? "bg-success" : a.pct >= 50 ? "bg-warning" : "bg-destructive")}
                          style={{ width: `${a.pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="tnum w-10 text-right text-[12.5px] text-muted-foreground">{a.pct}%</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
          {data.upcomingExam && (
            <SectionCard title="Next examination">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium leading-snug">{data.upcomingExam.name}</div>
                  <div className="tnum mt-0.5 text-[12.5px] text-muted-foreground">
                    {fmtDayDate(data.upcomingExam.startsOn)} — {fmtDayDate(data.upcomingExam.endsOn)}
                  </div>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Admissions pipeline" description="Inquiries this season" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("admissions")}>Inbox <ArrowRight className="h-3.5 w-3.5" /></Button>}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[
              ["NEW", "New"],
              ["CONTACTED", "Contacted"],
              ["VISIT_SCHEDULED", "Visits"],
              ["APPLICATION", "Applications"],
              ["ENROLLED", "Enrolled"],
              ["CLOSED", "Closed"],
            ].map(([key, label]) => (
              <div key={key} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <div className="tnum font-display text-lg font-semibold leading-none">{(data.admissionsFunnel as any)[key] ?? 0}</div>
                <div className="mt-1 text-[11.5px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Activity" description="Latest audited actions">
          <div className="max-h-[240px] space-y-3 overflow-y-auto scroll-slim pr-1">
            {(data.activity as any[]).map((a) => (
              <div key={a.id} className="flex items-start gap-2.5">
                <Avatar className="h-7 w-7">
                  <AvatarFallback style={{ background: avatarTint(a.actorName) }} className="text-[10px] font-semibold text-foreground/70">
                    {initials(a.actorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="text-[12.5px]">
                    <span className="font-medium">{a.actorName}</span>{" "}
                    <span className="text-muted-foreground">{a.action.toLowerCase()}</span>
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">{a.detail}</div>
                  <div className="text-[11px] text-muted-foreground/70">{timeAgo(a.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {(data.notices as any[]).length > 0 && (
        <SectionCard title="Notice board" description="Latest for all roles" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("notices")}>All notices <ArrowRight className="h-3.5 w-3.5" /></Button>}>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {(data.notices as any[]).map((n) => (
              <div key={n.id} className="rounded-lg border p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-medium leading-snug">{n.title}</div>
                  {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted-foreground">{timeAgo(n.publishedAt)}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ════════════════════════ TEACHER ════════════════════════ */

function TeacherDashboard({ data, ctx }: { data: any; ctx: ModuleCtx }) {
  const t = data.teacher;
  const hour = new Date().getHours();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${t.name.split(" ")[0]}`}
        subtitle={`${t.designation} · ${t.employeeCode} · ${t.specialization}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => ctx.go("lesson-planner")}>
            <BookOpenCheck className="h-3.5 w-3.5" /> Plan a lesson
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Classes I teach" value={data.classesTaught.length} sub={data.classTeacherOf.length > 0 ? `Class teacher of ${data.classTeacherOf.map((c: any) => c.name).join(", ")}` : "Not a class teacher"} icon={Layers} tone="primary" />
        <StatCard label="Periods today" value={data.todaySlots.length || "—"} sub={new Date().getDay() === 0 ? "Sunday" : "See today's plan"} icon={Clock3} />
        <StatCard
          label="Attendance pending"
          value={(data.pendingAttendance as any[]).filter((p) => !p.marked).length}
          sub="Home-room sections to mark"
          icon={CalendarCheck}
          tone={(data.pendingAttendance as any[]).some((p) => !p.marked) ? "warning" : "success"}
        />
        <StatCard label="Collected this month" value={inr(data.collections.sum, { compact: true })} sub={`${data.collections.count} receipts · ${data.collections.underVerification} awaiting verification`} icon={ReceiptIndianRupee} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Today" description="My timetable" className="lg:col-span-3">
          {data.todaySlots.length === 0 ? (
            <EmptyState icon={Clock3} title="No periods scheduled today" hint="Saturdays are half-days; Sundays are off." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(data.todaySlots as any[]).map((s) => (
                <div key={s.period} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3.5 py-3">
                  <span className="tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-[13px] font-semibold text-primary">
                    P{s.period}
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[13.5px] font-medium">{s.subject}</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {s.className}
                      {s.room ? ` · ${s.room}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            title="Mark attendance"
            description="Home-room duty"
            actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("attendance")}>Open <ArrowRight className="h-3.5 w-3.5" /></Button>}
          >
            {(data.pendingAttendance as any[]).length === 0 ? (
              <EmptyState title="Not a class teacher" hint="Attendance marking is a class-teacher duty." />
            ) : (
              <div className="space-y-2">
                {(data.pendingAttendance as any[]).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => ctx.go("attendance")}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5",
                      !p.marked && "border-warning/40 bg-warning/5",
                    )}
                  >
                    <div>
                      <div className="text-[13px] font-medium">{p.name}</div>
                      <div className="tnum text-[11.5px] text-muted-foreground">{p.strength} students</div>
                    </div>
                    {p.marked ? <Badge variant="outline" className="gap-1 text-[11px]"><StatusDot status="SUCCESS" />done</Badge> : <Badge variant="outline" className="border-warning/50 text-[11px] text-warning-foreground dark:text-warning">pending</Badge>}
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          {data.payslip && (
            <SectionCard title="My salary" description={`Payslip for ${new Date(data.payslip.month + "-15").toLocaleString("en-IN", { month: "long", year: "numeric" })}`} actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("salary")}>Details <ArrowRight className="h-3.5 w-3.5" /></Button>}>
              <div className="flex items-end justify-between">
                <div>
                  <div className="tnum font-display text-2xl font-semibold tracking-tight">{inr(data.payslip.net)}</div>
                  <div className="tnum mt-1 text-[12px] text-muted-foreground">
                    {inr(data.payslip.gross)} gross · {inr(data.payslip.deductions)} deducted
                  </div>
                </div>
                <Badge variant="secondary" className="gap-1.5"><StatusDot status={data.payslip.status} /></Badge>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Marks pending" description="PA1 entries still incomplete" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("marks")}>Marks entry <ArrowRight className="h-3.5 w-3.5" /></Button>}>
          {(data.marksPending as any[]).length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="All caught up" hint="Every PA1 slot you teach has marks entered." />
          ) : (
            <div className="space-y-2">
              {(data.marksPending as any[]).map((m) => (
                <button key={m.slotId} onClick={() => ctx.go("marks")} className="flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">
                      {m.className} · {m.subject}
                    </div>
                    <div className="tnum mt-0.5 text-[11.5px] text-muted-foreground">
                      {m.entered}/{m.total} entered
                    </div>
                  </div>
                  <div className="w-20">
                    <Progress value={(m.entered / Math.max(1, m.total)) * 100} className="h-1.5" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Notice board" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("notices")}>All <ArrowRight className="h-3.5 w-3.5" /></Button>}>
          <div className="space-y-3">
            {(data.notices as any[]).map((n) => (
              <div key={n.id} className="rounded-lg border p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-medium leading-snug">{n.title}</div>
                  {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{n.body}</p>
                <div className="mt-1.5 text-[11px] text-muted-foreground/70">{timeAgo(n.publishedAt)}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {(data.lessonsThisWeek as any[]).length > 0 && (
        <SectionCard title="Lesson plans this week" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("lesson-planner")}>Planner <ArrowRight className="h-3.5 w-3.5" /></Button>}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(data.lessonsThisWeek as any[]).map((l) => (
              <div key={l.id} className="rounded-lg border p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="text-[10.5px]">{l.className}</Badge>
                  <StatusDot status={l.status === "TAUGHT" ? "SUCCESS" : "DUE"} />
                </div>
                <div className="mt-2 text-[13px] font-medium leading-snug">{l.topic}</div>
                <div className="mt-1 text-[11.5px] text-muted-foreground">
                  {l.subject} · {fmtDayDate(l.date)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ════════════════════════ STUDENT ════════════════════════ */

function StudentDashboard({ data, ctx }: { data: any; ctx: ModuleCtx }) {
  const s = data.student;
  const hour = new Date().getHours();
  const attStatusColor: Record<string, string> = {
    PRESENT: "bg-success",
    ABSENT: "bg-destructive",
    LATE: "bg-warning",
    LEAVE: "bg-info",
  };
  const daysToExam = data.upcomingExam
    ? Math.max(0, Math.round((new Date(data.upcomingExam.startsOn + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000))
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${s.name.split(" ")[0]}`}
        subtitle={`${s.className} · Roll ${s.rollNo} · Adm. ${s.admissionNo}`}
        actions={
          data.fees.totalDue > 0 ? (
            <Button size="sm" variant="outline" className="border-warning/50 text-warning-foreground dark:text-warning" onClick={() => ctx.go("fees")}>
              <AlertTriangle className="h-3.5 w-3.5" /> {inr(data.fees.totalDue)} fee due
            </Button>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-success/40 bg-success/5 text-success"><StatusDot status="SUCCESS" /> fees clear</Badge>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="My attendance" value={data.attendance.pct != null ? `${data.attendance.pct}%` : "—"} sub={`${data.attendance.counts.ABSENT} absents · ${data.attendance.counts.LATE} late in ${data.attendance.considered} days`} icon={CalendarCheck} tone={data.attendance.pct >= 85 ? "success" : "warning"} />
        <StatCard label="Periods today" value={data.todaySlots.length || "—"} sub={DAYS_SHORT[new Date().getDay()] || "Sunday"} icon={Clock3} />
        <StatCard label="Half-yearly in" value={daysToExam != null ? `${daysToExam} days` : "—"} sub={data.upcomingExam ? `${fmtDayDate(data.upcomingExam.startsOn)} onwards` : "Datesheet awaited"} icon={Trophy} tone="primary" />
        <StatCard label="Fee due" value={inr(data.fees.totalDue)} sub={data.fees.totalDue > 0 ? "Clear before admit cards issue" : "All dues cleared"} icon={Wallet} tone={data.fees.totalDue > 0 ? "warning" : "success"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Today's classes" className="lg:col-span-3">
          {data.todaySlots.length === 0 ? (
            <EmptyState icon={Clock3} title="No periods today" hint="Enjoy the holiday — or open the timetable to plan ahead." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(data.todaySlots as any[]).map((sl: any) => (
                <div key={sl.period} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3.5 py-3">
                  <span className="tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-[13px] font-semibold text-primary">
                    P{sl.period}
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[13.5px] font-medium">{sl.subject}</div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {sl.teacher}
                      {sl.room ? ` · ${sl.room}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Last fortnight" description="My attendance strip" className="lg:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {(data.attendance.recent as any[]).map((a, i) => (
              <div
                key={i}
                title={`${fmtDayDate(a.date)} — ${a.status.toLowerCase()}`}
                className={cn("h-6 w-6 rounded-md", attStatusColor[a.status] ?? "bg-muted")}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
            {Object.entries(attStatusColor).map(([st, cls]) => (
              <span key={st} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", cls)} /> {st.toLowerCase()}
              </span>
            ))}
          </div>
        </SectionCard>
      </div>

      {data.pa1 && (data.pa1.results as any[]).length > 0 && (
        <SectionCard title={data.pa1.name} description="My marks vs class average" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("results")}>Full result <ArrowRight className="h-3.5 w-3.5" /></Button>}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(data.pa1.results as any[]).map((r) => (
              <div key={r.subject} className="rounded-lg border p-3.5">
                <div className="flex items-baseline justify-between">
                  <div className="text-[12.5px] font-medium">{r.subject}</div>
                  <div className="tnum text-[13px] font-semibold">
                    {r.obtained ?? "—"}
                    <span className="text-muted-foreground/60">/{r.maxMarks}</span>
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/25" style={{ width: `${((r.classAvg ?? 0) / r.maxMarks) * 100}%` }} />
                    <div className={cn("absolute inset-y-0 left-0 rounded-full", (r.obtained ?? 0) >= (r.classAvg ?? 0) ? "bg-success" : "bg-warning")} style={{ width: `${((r.obtained ?? 0) / r.maxMarks) * 100}%` }} />
                  </div>
                  <div className="tnum mt-1.5 flex justify-between text-[10.5px] text-muted-foreground">
                    <span>class avg {r.classAvg ?? "—"}</span>
                    {r.grade && <span className="font-medium text-foreground/80">grade {r.grade}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Notice board" actions={<Button variant="ghost" size="sm" onClick={() => ctx.go("notices")}>All notices <ArrowRight className="h-3.5 w-3.5" /></Button>}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(data.notices as any[]).map((n) => (
            <div key={n.id} className="rounded-lg border p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[13px] font-medium leading-snug">{n.title}</div>
                {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{n.body}</p>
              <div className="mt-1.5 text-[11px] text-muted-foreground/70">{timeAgo(n.publishedAt)}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
