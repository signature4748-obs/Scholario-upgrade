"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { inr, fmtDate, fmtDateTime } from "@/lib/format";
import {
  PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid, StatusDot,
} from "@/components/modules/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Wallet, Landmark, BadgeCheck, Hourglass, Pencil, Plus, Check, X, Search, ReceiptText, AlertTriangle, CheckCircle2,
} from "lucide-react";

/* ── payload types ─────────────────────────────────────────────── */

interface FeeHeadRow {
  id: string; classId: string; head: string; amount: number;
  frequency: string; mandatory: boolean; sort: number;
}
interface FeesPrincipalPayload {
  role: "PRINCIPAL";
  kpis: { collected: number; outstanding: number; dueCount: number; toVerify: number; toVerifyCount: number };
  classes: { id: string; name: string }[];
  structures: { classId: string; className: string; heads: FeeHeadRow[] }[];
  students: { id: string; name: string; admissionNo: string; className: string }[];
}
interface LedgerPayload {
  role: "STUDENT";
  student: { id: string; name: string; admissionNo: string; className: string };
  totalDue: number;
  totalPaid: number;
  assessments: { id: string; head: string; frequency: string; amount: number; dueOn: string; status: string }[];
  payments: { id: string; receiptNo: string; amount: number; mode: string; status: string; note: string | null; paidOn: string; verifiedAt: string | null; collector: string | null }[];
}
interface VerifyPaymentRow {
  id: string; receiptNo: string; amount: number; mode: string; status: string;
  note: string | null; paidOn: string; verifiedAt: string | null;
  studentName: string; className: string; collector: string | null;
}

const FREQUENCY_LABEL: Record<string, string> = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual", ONE_TIME: "One-time" };
const MODE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque" };

/* ── module ────────────────────────────────────────────────────── */

export function FeesModule({ ctx }: { ctx: ModuleCtx }) {
  if (ctx.me.role === "STUDENT") return <StudentFees />;
  return <PrincipalFees />;
}

/* ── principal view ────────────────────────────────────────────── */

function PrincipalFees() {
  const qc = useQueryClient();
  const fees = useQuery({
    queryKey: ["fees"],
    queryFn: () => api<FeesPrincipalPayload>("/api/fees"),
  });
  const [studentId, setStudentId] = useState<string | null>(null);

  const ledger = useQuery({
    queryKey: ["fees", "ledger", studentId],
    queryFn: () => api<LedgerPayload>(`/api/fees?studentId=${studentId}`),
    enabled: !!studentId,
  });

  if (fees.isLoading) {
    return (
      <>
        <PageHeader title="Fees & Finance" subtitle="Structures, student ledgers and receipt verification." />
        <LoadingGrid count={3} />
        <div className="mt-6"><LoadingRows rows={6} /></div>
      </>
    );
  }
  if (fees.isError) return <><PageHeader title="Fees & Finance" /><ErrorState message={(fees.error as Error).message} /></>;
  const data = fees.data!;

  return (
    <>
      <PageHeader
        title="Fees & Finance"
        subtitle={`${data.kpis.dueCount.toLocaleString("en-IN")} assessments are open across the session.`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Collected this session" value={inr(data.kpis.collected)} icon={Landmark} tone="primary" sub={`${data.kpis.toVerifyCount ? "Another " + inr(data.kpis.toVerify) + " awaits verification" : "Nothing pending verification"}`} />
        <StatCard label="Outstanding dues" value={inr(data.kpis.outstanding)} icon={Wallet} tone="warning" sub={`${data.kpis.dueCount.toLocaleString("en-IN")} open assessments`} />
        <StatCard label="To verify" value={inr(data.kpis.toVerify)} icon={Hourglass} tone="info" sub={`${data.kpis.toVerifyCount} teacher-collected receipts`} />
      </div>

      <Tabs defaultValue="structures" className="mt-6">
        <TabsList>
          <TabsTrigger value="structures">Structures</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
        </TabsList>

        <TabsContent value="structures" className="mt-4">
          <StructuresTab data={data} />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab
            students={data.students}
            classes={data.classes}
            studentId={studentId}
            setStudentId={setStudentId}
            ledger={ledger}
            onMoneyMoved={() => {
              qc.invalidateQueries({ queryKey: ["fees"] });
              qc.invalidateQueries({ queryKey: ["payments"] });
            }}
          />
        </TabsContent>
        <TabsContent value="verification" className="mt-4">
          <VerificationTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ── structures tab ────────────────────────────────────────────── */

function StructuresTab({ data }: { data: FeesPrincipalPayload }) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState<string>(data.structures[0]?.classId ?? "");
  const group = data.structures.find((g) => g.classId === classId) ?? data.structures[0];

  const [editHead, setEditHead] = useState<FeeHeadRow | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const totals = useMemo(() => {
    const t = { MONTHLY: 0, QUARTERLY: 0, ANNUAL: 0, ONE_TIME: 0 } as Record<string, number>;
    group?.heads.forEach((h) => (t[h.frequency] = (t[h.frequency] ?? 0) + h.amount));
    return t;
  }, [group]);

  const editMutation = useMutation({
    mutationFn: (body: { id: string; amount: number }) => api("/api/fees/structures", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_d, vars) => {
      toast.success(`${editHead?.head} set to ${inr(vars.amount)} for ${group?.className}`);
      setEditHead(null);
      qc.invalidateQueries({ queryKey: ["fees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data.structures.length) {
    return <EmptyState icon={Wallet} title="No fee structures yet" hint="Add the first fee head for a class to start assessing dues." />;
  }

  return (
    <SectionCard
      title={group?.className ? `Fee heads — ${group.className}` : "Fee heads"}
      description="Amounts apply to every student of the class from the next assessment."
      actions={<AddHeadDialog classId={group?.classId ?? ""} className_={group?.className ?? ""} open={addOpen} onOpenChange={setAddOpen} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Choose class" /></SelectTrigger>
          <SelectContent className="max-h-72 scroll-slim">
            {data.structures.map((g) => (
              <SelectItem key={g.classId} value={g.classId}>{g.className} · {g.heads.length} heads</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap gap-1.5 text-[12px] text-muted-foreground">
          {totals.MONTHLY > 0 && <Badge variant="secondary" className="tnum">{inr(totals.MONTHLY)}/month</Badge>}
          {totals.QUARTERLY > 0 && <Badge variant="secondary" className="tnum">{inr(totals.QUARTERLY)}/quarter</Badge>}
          {totals.ANNUAL > 0 && <Badge variant="outline" className="tnum">{inr(totals.ANNUAL)} annual</Badge>}
          {totals.ONE_TIME > 0 && <Badge variant="outline" className="tnum">{inr(totals.ONE_TIME)} one-time</Badge>}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Head</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group?.heads.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {h.mandatory && <span className="h-1.5 w-1.5 rounded-full bg-destructive/70" aria-label="Mandatory" />}
                    {h.head}
                  </span>
                </TableCell>
                <TableCell><Badge variant="secondary">{FREQUENCY_LABEL[h.frequency] ?? h.frequency}</Badge></TableCell>
                <TableCell className="tnum text-right font-medium">{inr(h.amount)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${h.head} amount`}
                    onClick={() => { setEditHead(h); setEditAmount(String(h.amount)); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editHead} onOpenChange={(o) => !o && setEditHead(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit {editHead?.head}</DialogTitle>
            <DialogDescription>Monthly-equivalent amount for {group?.className}. Existing assessments stay as issued.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="head-amount">Amount (₹)</Label>
            <Input id="head-amount" type="number" min={1} value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="tnum" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditHead(null)}>Cancel</Button>
            <Button
              disabled={editMutation.isPending || !editAmount || Number(editAmount) < 1}
              onClick={() => editHead && editMutation.mutate({ id: editHead.id, amount: Math.round(Number(editAmount)) })}
            >
              {editMutation.isPending ? "Saving…" : "Save amount"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function AddHeadDialog({ classId, className_, open, onOpenChange }: { classId: string; className_: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [head, setHead] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [mandatory, setMandatory] = useState(true);

  const mutation = useMutation({
    mutationFn: () => api("/api/fees/structures", {
      method: "POST",
      body: JSON.stringify({ classId, head, amount: Math.round(Number(amount)), frequency, mandatory }),
    }),
    onSuccess: () => {
      toast.success(`${head} added for ${className_}`);
      setHead(""); setAmount(""); setFrequency("MONTHLY"); setMandatory(true);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["fees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" /> Add head</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add fee head — {className_}</DialogTitle>
          <DialogDescription>Charged to students of this class from the next assessment cycle.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="new-head">Head name</Label>
            <Input id="new-head" placeholder="e.g. Transport Fee" value={head} onChange={(e) => setHead(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-amount">Amount (₹)</Label>
            <Input id="new-amount" type="number" min={1} placeholder="e.g. 400" value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" />
          </div>
          <div className="grid gap-2">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[oklch(0.55_0.095_192)]" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
            Mandatory for every student
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || head.trim().length < 2 || !amount || Number(amount) < 1} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Adding…" : "Add head"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── ledger tab ────────────────────────────────────────────────── */

function LedgerTab({
  students, classes, studentId, setStudentId, ledger, onMoneyMoved,
}: {
  students: { id: string; name: string; admissionNo: string; className: string }[];
  classes: { id: string; name: string }[];
  studentId: string | null;
  setStudentId: (id: string | null) => void;
  ledger: ReturnType<typeof useQuery<LedgerPayload>>;
  onMoneyMoved: () => void;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  const selected = students.find((s) => s.id === studentId);

  return (
    <>
      <SectionCard
        title="Student ledger"
        description="Assessments and receipts, settled oldest dues first."
        actions={
          selected && (
            <Button size="sm" onClick={() => setRecordOpen(true)}>
              <ReceiptText className="h-4 w-4" /> Record payment
            </Button>
          )
        }
      >
        <StudentPicker students={students} classes={classes} value={studentId} onChange={setStudentId} />

        {!studentId && (
          <div className="mt-4">
            <EmptyState icon={Search} title="Pick a student to open their ledger" hint="Search by name or admission number, or narrow by class first." />
          </div>
        )}

        {studentId && ledger.isLoading && <div className="mt-4"><LoadingRows rows={5} /></div>}
        {studentId && ledger.isError && <div className="mt-4"><ErrorState message={(ledger.error as Error).message} /></div>}

        {studentId && ledger.data && (
          <div className="mt-4 space-y-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3">
              <div>
                <div className="text-sm font-semibold">{ledger.data.student.name}</div>
                <div className="text-[12px] text-muted-foreground">{ledger.data.student.className} · {ledger.data.student.admissionNo}</div>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-[11.5px] text-muted-foreground">Open dues</div>
                  <div className={`tnum font-display text-lg font-semibold ${ledger.data.totalDue > 0 ? "text-warning-foreground dark:text-warning" : "text-success"}`}>{inr(ledger.data.totalDue)}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-muted-foreground">Paid this session</div>
                  <div className="tnum font-display text-lg font-semibold">{inr(ledger.data.totalPaid)}</div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-[13px] font-semibold tracking-tight">Assessments</h4>
              <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Head</TableHead>
                      <TableHead>Due on</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.data.assessments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.head}</TableCell>
                        <TableCell className="tnum text-muted-foreground">{fmtDate(a.dueOn)}</TableCell>
                        <TableCell className="tnum text-right font-medium">{inr(a.amount)}</TableCell>
                        <TableCell><StatusDot status={a.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-[13px] font-semibold tracking-tight">Receipts</h4>
              {ledger.data.payments.length === 0 ? (
                <EmptyState icon={ReceiptText} title="No receipts yet" hint="Payments recorded at the office appear here with their receipt numbers." />
              ) : (
                <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Receipt</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Collected by</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.data.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-[12.5px]">{p.receiptNo}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtDateTime(p.paidOn)}</TableCell>
                          <TableCell>{MODE_LABEL[p.mode] ?? p.mode}</TableCell>
                          <TableCell className="tnum text-right font-medium">{inr(p.amount)}</TableCell>
                          <TableCell className="text-muted-foreground">{p.collector ?? "School office"}</TableCell>
                          <TableCell><StatusDot status={p.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      {selected && ledger.data && (
        <RecordPaymentDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          studentName={ledger.data.student.name}
          defaultAmount={ledger.data.totalDue}
          studentId={selected.id}
          onDone={onMoneyMoved}
        />
      )}
    </>
  );
}

function RecordPaymentDialog({
  open, onOpenChange, studentName, defaultAmount, studentId, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  studentName: string; defaultAmount: number; studentId: string; onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [mode, setMode] = useState("CASH");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => api<{ receiptNo: string; status: string }>("/api/payments", {
      method: "POST",
      body: JSON.stringify({ studentId, amount: Math.round(Number(amount)), mode, note: note.trim() || undefined }),
    }),
    onSuccess: (d) => {
      toast.success(`Receipt ${d.receiptNo} recorded for ${inr(Math.round(Number(amount)))} — ${studentName}`);
      setNote("");
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setAmount(String(defaultAmount || "")); setNote(""); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment — {studentName}</DialogTitle>
          <DialogDescription>
            Settles open dues oldest-first. {defaultAmount > 0 ? `Open dues: ${inr(defaultAmount)}.` : "No open dues — this will be held as an advance."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <Input id="pay-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" />
          </div>
          <div className="grid gap-2">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MODE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Input id="pay-note" placeholder="e.g. October fee, paid at counter" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || !amount || Number(amount) < 1} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── verification tab ──────────────────────────────────────────── */

function VerificationTab() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<VerifyPaymentRow | null>(null);

  const queue = useQuery({
    queryKey: ["payments", "principal", "UNDER_VERIFICATION"],
    queryFn: () => api<{ payments: VerifyPaymentRow[] }>("/api/payments?status=UNDER_VERIFICATION"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["fees"] });
  };

  const verifyMutation = useMutation({
    mutationFn: (paymentId: string) => api<{ receiptNo: string }>("/api/payments/verify", { method: "POST", body: JSON.stringify({ paymentId, action: "verify" }) }),
    onSuccess: (d) => { toast.success(`Receipt ${d.receiptNo} verified`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (paymentId: string) => api<{ receiptNo: string; reverted: number }>("/api/payments/verify", { method: "POST", body: JSON.stringify({ paymentId, action: "reject" }) }),
    onSuccess: (d) => {
      toast.success(`Receipt ${d.receiptNo} rejected${d.reverted ? ` — ${d.reverted} due${d.reverted > 1 ? "s" : ""} reopened` : ""}`);
      setRejecting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (queue.isLoading) return <SectionCard title="Awaiting verification"><LoadingRows rows={5} /></SectionCard>;
  if (queue.isError) return <ErrorState message={(queue.error as Error).message} />;
  const rows = queue.data!.payments;

  return (
    <>
      <SectionCard
        title="Teacher-collected receipts"
        description="Verify to confirm, or reject to reopen the dues the receipt was carrying."
      >
        {rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing waiting for verification." hint="Every teacher-collected receipt has been confirmed." />
        ) : (
          <div className="max-h-[28rem] overflow-y-auto scroll-slim rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Collected by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Paid on</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-[12.5px]">{p.receiptNo}</TableCell>
                    <TableCell>
                      <div className="font-medium">{p.studentName}</div>
                      <div className="text-[11.5px] text-muted-foreground">{p.className}</div>
                    </TableCell>
                    <TableCell>{p.collector ?? "School office"}</TableCell>
                    <TableCell className="tnum text-right font-medium">{inr(p.amount)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(p.paidOn)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm" variant="outline" disabled={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate(p.id)}
                        >
                          <Check className="h-3.5 w-3.5" /> Verify
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={rejectMutation.isPending}
                          onClick={() => setRejecting(p)}
                          aria-label={`Reject ${p.receiptNo}`}
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <AlertDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Reject receipt {rejecting?.receiptNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejecting && (
                <>
                  {inr(rejecting.amount)} collected by {rejecting.collector ?? "the school office"} for {rejecting.studentName} ({rejecting.className}) will be marked rejected, and the dues it was carrying will reopen for the student.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep receipt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={rejectMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (rejecting) rejectMutation.mutate(rejecting.id); }}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject receipt"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ── student view ──────────────────────────────────────────────── */

function StudentFees() {
  const ledger = useQuery({
    queryKey: ["fees", "my"],
    queryFn: () => api<LedgerPayload>("/api/fees"),
  });

  if (ledger.isLoading) {
    return (
      <>
        <PageHeader title="My Fees" />
        <LoadingGrid count={2} />
        <div className="mt-6"><LoadingRows rows={6} /></div>
      </>
    );
  }
  if (ledger.isError) return <><PageHeader title="My Fees" /><ErrorState message={(ledger.error as Error).message} /></>;
  const d = ledger.data!;

  return (
    <>
      <PageHeader
        title="My Fees"
        subtitle={`${d.student.className} · Admission no. ${d.student.admissionNo}`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Open dues" value={inr(d.totalDue)} icon={Wallet}
          tone={d.totalDue > 0 ? "warning" : "success"}
          sub={d.totalDue > 0 ? "Clear at the school office or via UPI at the counter." : "All assessed dues are cleared."}
        />
        <StatCard label="Paid this session" value={inr(d.totalPaid)} icon={BadgeCheck} tone="primary" sub={`${d.payments.filter((p) => p.status === "SUCCESS").length} receipts issued`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Assessments" description="Heads charged this session, oldest first.">
          {d.assessments.length === 0 ? (
            <EmptyState icon={Wallet} title="No assessments yet" hint="Fee heads for your class will appear here once issued." />
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Head</TableHead>
                    <TableHead>Due on</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.assessments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.head}</TableCell>
                      <TableCell className="tnum text-muted-foreground">{fmtDate(a.dueOn)}</TableCell>
                      <TableCell className="tnum text-right font-medium">{inr(a.amount)}</TableCell>
                      <TableCell><StatusDot status={a.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="My receipts" description="Every payment recorded against your admission number.">
          {d.payments.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No receipts yet" hint="Receipts appear the same day a payment is recorded at the office." />
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-[12.5px]">{p.receiptNo}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDateTime(p.paidOn)}</TableCell>
                      <TableCell>{MODE_LABEL[p.mode] ?? p.mode}</TableCell>
                      <TableCell className="tnum text-right font-medium">{inr(p.amount)}</TableCell>
                      <TableCell><StatusDot status={p.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            Fee payments are accepted at the school office or via UPI at the counter — receipts are issued the same day.
          </p>
        </SectionCard>
      </div>
    </>
  );
}

/* ── shared: student picker combobox ───────────────────────────── */

function StudentPicker({
  students, classes, value, onChange,
}: {
  students: { id: string; name: string; admissionNo: string; className: string }[];
  classes: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState("ALL");
  const selected = students.find((s) => s.id === value);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return students.filter((s) =>
      (classFilter === "ALL" || s.className === classFilter) &&
      (!needle || s.name.toLowerCase().includes(needle) || s.admissionNo.toLowerCase().includes(needle)),
    );
  }, [students, q, classFilter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full max-w-sm justify-between sm:w-[360px]">
          {selected ? (
            <span className="flex items-baseline gap-2 truncate">
              {selected.name}
              <span className="text-[11.5px] text-muted-foreground">{selected.className} · {selected.admissionNo}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Search a student…</span>
          )}
          <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2.5 py-2">
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="h-8 w-[150px] text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-64 scroll-slim">
              <SelectItem value="ALL">All classes</SelectItem>
              {classes.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="tnum ml-auto text-[11.5px] text-muted-foreground">{filtered.length} students</span>
        </div>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Name or admission no…" value={q} onValueChange={setQ} />
          <CommandList className="scroll-slim">
            <CommandEmpty>No student found.</CommandEmpty>
            {filtered.slice(0, 150).map((s) => (
              <CommandItem
                key={s.id}
                value={s.id}
                onSelect={() => { onChange(s.id); setOpen(false); setQ(""); }}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">{s.className} · {s.admissionNo}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
