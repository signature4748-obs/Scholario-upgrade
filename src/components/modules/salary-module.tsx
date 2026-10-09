"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { inr, fmtDate } from "@/lib/format";
import {
  PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid, StatusDot,
} from "@/components/modules/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banknote, Users, Wallet, FileText, Landmark, ReceiptText } from "lucide-react";

interface PayslipRow {
  id: string; month: string; gross: number; deductions: number; net: number;
  status: string; paidOn: string | null; epf: number; pt: number; teacherName?: string;
}
interface PrincipalPayload {
  role: "PRINCIPAL";
  totals: { teachers: number; monthlyGross: number; payslipCount: number };
  teachers: { id: string; name: string; designation: string; employeeCode: string; gross: number; lastPayslip: { month: string; net: number } | null }[];
  payslips: PayslipRow[];
}
interface TeacherPayload {
  role: "TEACHER";
  teacher: { name: string; designation: string; employeeCode: string; gross: number };
  payslips: PayslipRow[];
}

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_FULL[parseInt(m ?? "1", 10) - 1] ?? m} ${y}`;
}

export function SalaryModule({ ctx }: { ctx: ModuleCtx }) {
  if (ctx.me.role === "TEACHER") return <TeacherSalary />;
  return <PrincipalSalary />;
}

/* ── principal view ────────────────────────────────────────────── */

function PrincipalSalary() {
  const qc = useQueryClient();
  const [processOpen, setProcessOpen] = useState(false);

  const data = useQuery({
    queryKey: ["salary"],
    queryFn: () => api<PrincipalPayload>("/api/salary"),
  });

  const byMonth = useMemo(() => {
    const groups = new Map<string, PayslipRow[]>();
    for (const p of data.data?.payslips ?? []) {
      const g = groups.get(p.month) ?? [];
      g.push(p);
      groups.set(p.month, g);
    }
    return [...groups.entries()];
  }, [data.data]);

  if (data.isLoading) {
    return (
      <>
        <PageHeader title="Salary" subtitle="Monthly payroll for the teaching staff." />
        <LoadingGrid count={2} />
        <div className="mt-6"><LoadingRows rows={8} /></div>
      </>
    );
  }
  if (data.isError) return <><PageHeader title="Salary" /><ErrorState message={(data.error as Error).message} /></>;
  const d = data.data!;

  return (
    <>
      <PageHeader
        title="Salary"
        subtitle={`Monthly payroll — EPF 12% (capped at ${inr(1800)}) plus ${inr(200)} professional tax.`}
        actions={
          <Button size="sm" onClick={() => setProcessOpen(true)}>
            <FileText className="h-4 w-4" /> Process payslips
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Teaching staff" value={String(d.totals.teachers)} icon={Users}
          sub={`Monthly gross outlay ${inr(d.totals.monthlyGross)}`}
        />
        <StatCard
          label="Payslips issued" value={String(d.totals.payslipCount)} icon={Banknote} tone="primary"
          sub={byMonth[0] ? `Latest run — ${monthLabel(byMonth[0][0])}` : "No payroll run yet"}
        />
      </div>

      <SectionCard className="mt-6" title="Staff payroll" description="Gross monthly salary and the latest payslip issued to each teacher.">
        <div className="max-h-[26rem] overflow-y-auto scroll-slim rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead className="hidden md:table-cell">Designation</TableHead>
                <TableHead className="hidden lg:table-cell">Employee code</TableHead>
                <TableHead className="text-right">Gross / month</TableHead>
                <TableHead className="text-right">Last payslip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.teachers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{t.designation}</TableCell>
                  <TableCell className="hidden lg:table-cell font-mono text-[12.5px] text-muted-foreground">{t.employeeCode}</TableCell>
                  <TableCell className="tnum text-right font-medium">{inr(t.gross)}</TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">
                    {t.lastPayslip ? (
                      <span>{monthLabel(t.lastPayslip.month)} · <span className="font-medium text-foreground">{inr(t.lastPayslip.net)}</span></span>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <div className="mt-6 space-y-6">
        <h3 className="text-[14.5px] font-semibold tracking-tight">Payslip history</h3>
        {byMonth.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No payslips yet" hint="Process a month to issue payslips to every active teacher." />
        ) : (
          byMonth.map(([month, rows]) => (
            <SectionCard
              key={month}
              title={monthLabel(month)}
              description={`${rows.length} payslips · ${inr(rows.reduce((t, r) => t + r.net, 0))} net paid out`}
            >
              <div className="max-h-72 overflow-y-auto scroll-slim rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Teacher</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="hidden sm:table-cell">Paid on</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.teacherName}</TableCell>
                        <TableCell className="tnum text-right">{inr(p.gross)}</TableCell>
                        <TableCell className="tnum text-right text-muted-foreground">{inr(p.deductions)}</TableCell>
                        <TableCell className="tnum text-right font-medium">{inr(p.net)}</TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">{p.paidOn ? fmtDate(p.paidOn) : "—"}</TableCell>
                        <TableCell><StatusDot status={p.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          ))
        )}
      </div>

      <ProcessPayslipsDialog
        open={processOpen}
        onOpenChange={setProcessOpen}
        activeTeachers={d.totals.teachers}
        onDone={() => qc.invalidateQueries({ queryKey: ["salary"] })}
      />
    </>
  );
}

function ProcessPayslipsDialog({
  open, onOpenChange, activeTeachers, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  activeTeachers: number; onDone: () => void;
}) {
  const [month, setMonth] = useState("2026-10");

  const mutation = useMutation({
    mutationFn: () => api<{ month: string; processed: number; skipped: number; reason?: string }>("/api/salary", {
      method: "POST",
      body: JSON.stringify({ month }),
    }),
    onSuccess: (d) => {
      if (d.reason === "already-processed" && d.processed === 0) {
        toast.info(`Payslips for ${monthLabel(d.month)} already exist — nothing new to process.`);
      } else {
        toast.success(`${d.processed} payslip${d.processed === 1 ? "" : "s"} processed for ${monthLabel(d.month)}`);
      }
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Process payslips</DialogTitle>
          <DialogDescription>
            Creates a paid payslip for each of the {activeTeachers} active teachers — gross equals monthly salary, EPF 12% capped at {inr(1800)} plus {inr(200)} PT. Teachers already paid for the month are skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="payroll-month">Month</Label>
          <Input id="payroll-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="tnum" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || !month} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Processing…" : "Process month"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── teacher view ──────────────────────────────────────────────── */

function TeacherSalary() {
  const data = useQuery({
    queryKey: ["salary"],
    queryFn: () => api<TeacherPayload>("/api/salary"),
  });

  if (data.isLoading) {
    return (
      <>
        <PageHeader title="My Salary" />
        <LoadingGrid count={2} />
        <div className="mt-6"><LoadingRows rows={5} /></div>
      </>
    );
  }
  if (data.isError) return <><PageHeader title="My Salary" /><ErrorState message={(data.error as Error).message} /></>;
  const d = data.data!;
  const latest = d.payslips[0];

  return (
    <>
      <PageHeader
        title="My Salary"
        subtitle={`${d.teacher.designation} · ${d.teacher.employeeCode}`}
      />

      {!latest ? (
        <EmptyState
          icon={Wallet}
          title="No payslips yet"
          hint={`Your gross salary is ${inr(d.teacher.gross)} per month — payslips appear here once the office processes payroll.`}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <SectionCard
            title={monthLabel(latest.month)}
            description={`Paid on ${latest.paidOn ? fmtDate(latest.paidOn) : "—"}`}
            actions={<StatusDot status={latest.status} />}
          >
            <div className="rounded-lg border">
              <div className="flex items-baseline justify-between gap-4 border-b px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Landmark className="h-3.5 w-3.5" /> Gross salary</span>
                <span className="tnum font-display text-lg font-semibold">{inr(latest.gross)}</span>
              </div>
              <div className="px-4 py-3">
                <div className="text-[12.5px] font-medium">Deductions — {inr(latest.deductions)}</div>
                <div className="mt-1.5 text-[12px] text-muted-foreground">
                  EPF {inr(latest.epf)} · PT {inr(latest.pt)}
                </div>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t bg-muted/40 px-4 py-3">
                <span className="text-sm font-medium">Net pay</span>
                <span className="tnum font-display text-xl font-semibold text-primary">{inr(latest.net)}</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Payslip history" description="Net credited each month.">
            {d.payslips.length <= 1 ? (
              <EmptyState icon={ReceiptText} title="First payslip" hint="Earlier months will appear as payroll is processed." />
            ) : (
              <div className="max-h-96 space-y-1 overflow-y-auto scroll-slim">
                {d.payslips.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div>
                      <div className="text-[13px] font-medium">{monthLabel(p.month)}</div>
                      <div className="text-[11.5px] text-muted-foreground">{p.paidOn ? `Paid ${fmtDate(p.paidOn)}` : "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="tnum text-[13px] font-semibold">{inr(p.net)}</div>
                      <div className="text-[11px] text-muted-foreground">of {inr(p.gross)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </>
  );
}
