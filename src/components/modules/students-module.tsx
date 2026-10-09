"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import {
  PageHeader, EmptyState, ErrorState, LoadingRows, StatusDot,
} from "@/components/modules/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Search, UserPlus, Users, ChevronLeft, ChevronRight, Loader2, Copy, Check,
  Phone, Wallet, Trophy, CalendarOff, ShieldAlert, ShieldCheck, CheckCircle2,
} from "lucide-react";
import { inr, fmtDate, initials, avatarTint } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ── small shared helpers ───────────────────────────────────────── */

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — please select the text manually.");
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-[13px]">{value}</div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={`Copy ${label}`} className="h-8 w-8 shrink-0 p-0">
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

interface StudentRow {
  id: string; admissionNo: string; name: string; rollNo: number; classId: string; className: string;
  gender: string | null; guardianName: string | null; guardianPhone: string | null; status: string;
}
interface ClassOption { id: string; name: string }

/* ── module ─────────────────────────────────────────────────────── */

export function StudentsModule({ ctx }: { ctx: ModuleCtx }) {
  const isPrincipal = ctx.me.role === "PRINCIPAL";

  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [classId, setClassId] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);

  // filters changing always restart the directory from page 1
  const changeClass = (v: string) => {
    setClassId(v);
    setPage(1);
  };
  const changeStatus = (v: string) => {
    setStatus(v);
    setPage(1);
  };

  const classesQ = useQuery({
    queryKey: ["classes"],
    queryFn: () => api<{ classes: ClassOption[] }>("/api/classes"),
  });

  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (classId !== "all") sp.set("classId", classId);
    if (status !== "all") sp.set("status", status);
    sp.set("page", String(page));
    return sp.toString();
  }, [q, classId, status, page]);

  const listQ = useQuery({
    queryKey: ["students", { q, classId, status, page }],
    queryFn: () => api<{
      total: number; page: number; pageSize: number; pageCount: number; students: StudentRow[];
    }>(`/api/students?${params}`),
    placeholderData: keepPreviousData,
  });

  const data = listQ.data;
  const classOptions: ClassOption[] = classesQ.data?.classes ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Students"
        subtitle={
          isPrincipal
            ? `${ctx.me.school.shortName ?? ctx.me.school.name} · ${ctx.me.school.academicYear} session`
            : "Students in the classes you teach or manage"
        }
        actions={
          isPrincipal ? (
            <Button size="sm" onClick={() => { setAddKey((k) => k + 1); setAddOpen(true); }}>
              <UserPlus className="h-3.5 w-3.5" /> Add student
            </Button>
          ) : undefined
        }
      />

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or admission no…"
            aria-label="Search students"
            className="h-9 pl-8"
          />
        </div>
        <Select value={classId} onValueChange={changeClass}>
          <SelectTrigger size="sm" className="h-9 w-[150px]" aria-label="Filter by class">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={changeStatus}>
          <SelectTrigger size="sm" className="h-9 w-[130px]" aria-label="Filter by status">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="ACTIVE">On roll</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
          </SelectContent>
        </Select>
        {listQ.isFetching && !listQ.isLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" aria-label="Refreshing" />
        )}
      </div>

      {/* list */}
      {listQ.isLoading ? (
        <LoadingRows rows={8} />
      ) : listQ.isError ? (
        <ErrorState message={(listQ.error as Error)?.message ?? "Couldn't load the student directory."} />
      ) : !data || data.students.length === 0 ? (
        <EmptyState
          icon={Users}
          title={data && data.total === 0 && (q || classId !== "all" || status !== "all") ? "No students match these filters" : "No students yet"}
          hint={
            data && data.total === 0 && (q || classId !== "all" || status !== "all")
              ? "Try a different spelling, or clear the class and status filters."
              : "Admissions and enquiries enrolled from the Admissions module will appear here."
          }
          action={
            (q || classId !== "all" || status !== "all") ? (
              <Button variant="outline" size="sm" onClick={() => { setSearch(""); setClassId("all"); setStatus("all"); setPage(1); }}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 pl-4 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Adm No</TableHead>
                  <TableHead className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Student</TableHead>
                  <TableHead className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Class</TableHead>
                  <TableHead className="hidden text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground md:table-cell">Roll</TableHead>
                  <TableHead className="hidden text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground lg:table-cell">Guardian</TableHead>
                  <TableHead className="hidden text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground lg:table-cell">Phone</TableHead>
                  <TableHead className="pr-4 text-right text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.students.map((s) => (
                  <TableRow
                    key={s.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open profile for ${s.name}`}
                    onClick={() => setProfileId(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setProfileId(s.id);
                      }
                    }}
                    className="cursor-pointer outline-none focus-visible:bg-muted/60 hover:bg-muted/50"
                  >
                    <TableCell className="tnum whitespace-nowrap pl-4 text-[12.5px] text-muted-foreground">{s.admissionNo}</TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback
                            style={{ background: avatarTint(s.name) }}
                            className="text-[11px] font-semibold text-foreground/70"
                          >
                            {initials(s.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[13.5px] font-medium leading-none">{s.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{s.className}</TableCell>
                    <TableCell className="tnum hidden text-[13px] md:table-cell">{s.rollNo}</TableCell>
                    <TableCell className="hidden max-w-[160px] truncate text-[12.5px] text-muted-foreground lg:table-cell">
                      {s.guardianName ?? "—"}
                    </TableCell>
                    <TableCell className="tnum hidden whitespace-nowrap text-[12.5px] text-muted-foreground lg:table-cell">
                      {s.guardianPhone ?? "—"}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <StatusDot status={s.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* pagination */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
            <p className="tnum text-[12.5px] text-muted-foreground">
              Showing {(data.page - 1) * data.pageSize + 1}–{(data.page - 1) * data.pageSize + data.students.length} of {data.total}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline" size="sm" className="h-8" disabled={data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="tnum px-1 text-[12.5px] text-muted-foreground">
                Page {data.page} of {data.pageCount}
              </span>
              <Button
                variant="outline" size="sm" className="h-8" disabled={data.page >= data.pageCount}
                onClick={() => setPage((p) => p + 1)} aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* profile dialog */}
      <StudentProfileDialog
        studentId={profileId}
        isPrincipal={isPrincipal}
        onClose={() => setProfileId(null)}
      />

      {/* add student (principal) */}
      {isPrincipal && (
        <AddStudentDialog
          key={addKey}
          open={addOpen}
          onOpenChange={setAddOpen}
          classes={classOptions}
        />
      )}
    </div>
  );
}

/* ── profile dialog ─────────────────────────────────────────────── */

interface ProfileData {
  student: {
    id: string; admissionNo: string; name: string; rollNo: number; className: string; classTeacher: string | null;
    gender: string | null; dob: string | null; guardianName: string | null; guardianPhone: string | null;
    address: string | null; admittedOn: string; status: string; email: string | null;
  };
  attendance: { pct: number | null; counts: Record<string, number>; considered: number };
  fees: { totalDue: number; dueCount: number; items: { head: string; amount: number; dueOn: string }[] };
  pa1: {
    name: string;
    subjects: { subject: string; obtained: number | null; maxMarks: number; grade: string | null; classAvg: number | null }[];
    overallPct: number | null;
  } | null;
}

function StudentProfileDialog({
  studentId, isPrincipal, onClose,
}: {
  studentId: string | null;
  isPrincipal: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["student", studentId],
    queryFn: () => api<ProfileData>(`/api/students/${studentId}`),
    enabled: !!studentId,
  });

  const statusMutation = useMutation({
    mutationFn: (status: "SUSPENDED" | "ACTIVE") =>
      api<{ status: string }>(`/api/students/${studentId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (d, status) => {
      const name = q.data?.student.name ?? "Student";
      toast.success(status === "SUSPENDED" ? `${name} suspended` : `${name} is back on roll`);
      qc.invalidateQueries({ queryKey: ["student", studentId] });
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  const student = d?.student;

  return (
    <Dialog open={!!studentId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto scroll-slim sm:max-w-2xl">
        {q.isLoading || !student ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
              <div className="space-y-1.5">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-56 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-[74px] animate-pulse rounded-lg bg-muted" />)}
            </div>
            <div className="h-28 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : q.isError ? (
          <ErrorState message={(q.error as Error)?.message ?? "Couldn't load this profile."} />
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3.5">
                <Avatar className="h-12 w-12">
                  <AvatarFallback style={{ background: avatarTint(student.name) }} className="text-[15px] font-semibold text-foreground/70">
                    {initials(student.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="leading-tight">{student.name}</DialogTitle>
                  <DialogDescription className="tnum mt-1">
                    {student.admissionNo} · {student.className} · Roll {student.rollNo}
                    {student.classTeacher ? ` · Class teacher ${student.classTeacher}` : ""}
                  </DialogDescription>
                  <div className="mt-2"><StatusDot status={student.status} /></div>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/25 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                    <CalendarOff className="h-3 w-3" /> Attendance
                  </div>
                  <div className="tnum mt-1 font-display text-[19px] font-semibold leading-none">
                    {d.attendance.pct != null ? `${d.attendance.pct}%` : "—"}
                  </div>
                  <div className="tnum mt-1 text-[11px] text-muted-foreground">{d.attendance.considered} school days</div>
                </div>
                <div className="rounded-lg border bg-muted/25 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                    <Wallet className="h-3 w-3" /> Fee dues
                  </div>
                  <div className={cn("tnum mt-1 font-display text-[19px] font-semibold leading-none", d.fees.totalDue > 0 && "text-warning-foreground dark:text-warning")}>
                    {d.fees.totalDue > 0 ? inr(d.fees.totalDue) : "Clear"}
                  </div>
                  <div className="tnum mt-1 text-[11px] text-muted-foreground">
                    {d.fees.dueCount > 0 ? `${d.fees.dueCount} outstanding heads` : "nothing pending"}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/25 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                    <Trophy className="h-3 w-3" /> {d.pa1 && d.pa1.subjects.length > 0 ? "PA1 overall" : "PA1"}
                  </div>
                  <div className="tnum mt-1 font-display text-[19px] font-semibold leading-none">
                    {d.pa1?.overallPct != null ? `${d.pa1.overallPct}%` : "—"}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {d.pa1 && d.pa1.subjects.length > 0
                      ? `${d.pa1.subjects.length} subjects`
                      : d.pa1
                        ? "not assessed for this class"
                        : "no published PA1"}
                  </div>
                </div>
              </div>

              {/* attendance breakdown */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-3.5 py-2.5">
                {(Object.keys(d.attendance.counts) as (keyof typeof d.attendance.counts)[]).map((k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <StatusDot status={k} />
                    <span className="tnum text-[12.5px] font-medium">{d.attendance.counts[k]}</span>
                  </span>
                ))}
              </div>

              {/* guardian + contact */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border p-3.5">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Guardian & contact</div>
                  <dl className="mt-2.5 space-y-1.5 text-[13px]">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Guardian</dt>
                      <dd className="text-right font-medium">{student.guardianName ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Phone</dt>
                      <dd className="tnum text-right">{student.guardianPhone ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Date of birth</dt>
                      <dd className="tnum text-right">{student.dob ? fmtDate(student.dob) : "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Admitted</dt>
                      <dd className="tnum text-right">{fmtDate(student.admittedOn)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Login</dt>
                      <dd className="max-w-[60%] truncate text-right font-mono text-[12px]">{student.email ?? "—"}</dd>
                    </div>
                    {student.address && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Address</dt>
                        <dd className="max-w-[60%] text-right text-muted-foreground">{student.address}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* fee dues */}
                <div className="rounded-lg border p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Outstanding fees</div>
                    {d.fees.totalDue > 0 && <Badge variant="secondary" className="tnum h-5 bg-warning/15 text-[11px] text-warning-foreground dark:text-warning">{inr(d.fees.totalDue)}</Badge>}
                  </div>
                  {d.fees.items.length === 0 ? (
                    <p className="mt-2.5 text-[12.5px] text-muted-foreground">No pending assessments for this session.</p>
                  ) : (
                    <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto scroll-slim pr-1">
                      {d.fees.items.map((f, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="truncate">{f.head}</span>
                          <span className="tnum flex shrink-0 items-center gap-2 text-muted-foreground">
                            {fmtDate(f.dueOn)}
                            <span className="font-medium text-foreground">{inr(f.amount)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* PA1 summary */}
              {d.pa1 && d.pa1.subjects.length > 0 && (
                <div className="rounded-lg border p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{d.pa1.name}</div>
                    {d.pa1.overallPct != null && (
                      <Badge variant="secondary" className="tnum h-5 bg-primary/10 text-[11px] text-primary">{d.pa1.overallPct}% overall</Badge>
                    )}
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <Table className="min-w-[380px]">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-8 text-[11px] uppercase tracking-wide text-muted-foreground">Subject</TableHead>
                          <TableHead className="h-8 text-[11px] uppercase tracking-wide text-muted-foreground">Score</TableHead>
                          <TableHead className="h-8 text-[11px] uppercase tracking-wide text-muted-foreground">Grade</TableHead>
                          <TableHead className="h-8 text-right text-[11px] uppercase tracking-wide text-muted-foreground">Class avg</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.pa1.subjects.map((s) => (
                          <TableRow key={s.subject} className="hover:bg-muted/40">
                            <TableCell className="py-1.5 text-[13px]">{s.subject}</TableCell>
                            <TableCell className="tnum py-1.5 text-[13px]">
                              {s.obtained != null ? `${s.obtained} / ${s.maxMarks}` : "not assessed"}
                            </TableCell>
                            <TableCell className="py-1.5">
                              {s.grade ? <Badge variant="secondary" className="h-5 bg-muted text-[11px]">{s.grade}</Badge> : "—"}
                            </TableCell>
                            <TableCell className="tnum py-1.5 text-right text-[12.5px] text-muted-foreground">
                              {s.classAvg != null ? s.classAvg : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>

            {isPrincipal && (
              <DialogFooter className="gap-2 sm:justify-between">
                {student.status === "ACTIVE" ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={statusMutation.isPending}>
                        <ShieldAlert className="h-3.5 w-3.5" /> Suspend
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Suspend {student.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Their login is disabled immediately and they drop out of attendance duty. The seat and
                          records stay intact — you can reactivate from this profile whenever they return.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep on roll</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={() => statusMutation.mutate("SUSPENDED")}
                        >
                          {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Suspend"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    variant="outline" size="sm" disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate("ACTIVE")}
                  >
                    {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    Reactivate
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── add student dialog (principal) ─────────────────────────────── */

interface CreatedStudent {
  name: string; admissionNo: string; rollNo: number; className: string; email: string; password: string;
}

function AddStudentDialog({
  open, onOpenChange, classes,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classes: ClassOption[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", classId: "", gender: "M", guardianName: "", guardianPhone: "", dob: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedStudent | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<CreatedStudent>("/api/students", {
        method: "POST",
        body: JSON.stringify({ ...form, dob: form.dob || undefined }),
      }),
    onSuccess: (d) => {
      setCreated(d);
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid =
    form.name.trim().length >= 3 &&
    !!form.classId &&
    form.guardianName.trim().length >= 3 &&
    form.guardianPhone.replace(/\D/g, "").length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? "Student enrolled" : "Add a student"}</DialogTitle>
          <DialogDescription>
            {created
              ? "A login has been created — copy the credentials now, they are shown only once."
              : "Admission number and roll are assigned automatically. A student login is created with the school's standard password."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3.5">
            <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/5 px-3.5 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div className="text-[13px] leading-snug">
                <span className="font-medium">{created.name}</span> is on roll in{" "}
                <span className="font-medium">{created.className}</span> · roll{" "}
                <span className="tnum font-medium">{created.rollNo}</span>.
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 text-[13px]">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Admission no</dt>
                <dd className="tnum mt-0.5 font-medium">{created.admissionNo}</dd>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Class · Roll</dt>
                <dd className="mt-0.5 font-medium">{created.className} · <span className="tnum">{created.rollNo}</span></dd>
              </div>
            </dl>
            <CopyField label="Login email" value={created.email} />
            <CopyField label="Password" value={created.password} />
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <form
            className="space-y-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) {
                setFormError("Name, class, guardian name and a 10-digit phone are needed.");
                return;
              }
              setFormError(null);
              create.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="st-name">Full name</Label>
              <Input id="st-name" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Aarav Pandey" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="st-class">Class</Label>
                <Select value={form.classId} onValueChange={set("classId")}>
                  <SelectTrigger id="st-class" className="w-full">
                    <SelectValue placeholder="Pick a class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-gender">Gender</Label>
                <Select value={form.gender} onValueChange={set("gender")}>
                  <SelectTrigger id="st-gender" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Male</SelectItem>
                    <SelectItem value="F">Female</SelectItem>
                    <SelectItem value="O">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-guardian">Guardian name</Label>
                <Input id="st-guardian" value={form.guardianName} onChange={(e) => set("guardianName")(e.target.value)} placeholder="e.g. Smt. Rekha Pandey" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-phone">Guardian phone</Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <Input id="st-phone" value={form.guardianPhone} onChange={(e) => set("guardianPhone")(e.target.value)} placeholder="+91 98765 43210" className="pl-8" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-dob">Date of birth <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="st-dob" type="date" value={form.dob} onChange={(e) => set("dob")(e.target.value)} />
            </div>

            {formError && <ErrorState message={formError} />}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || !valid}>
                {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enroll student
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
