"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { inr, fmtDateTime } from "@/lib/format";
import {
  PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid, StatusDot,
} from "@/components/modules/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ReceiptIndianRupee, Hourglass, Plus, Search, CheckCircle2 } from "lucide-react";

interface CollectionPayload {
  role: "TEACHER";
  month: { total: number; count: number; pending: number };
  myStudents: { id: string; name: string; admissionNo: string; className: string }[];
  payments: {
    id: string; receiptNo: string; amount: number; mode: string; status: string;
    note: string | null; paidOn: string; verifiedAt: string | null;
    studentName: string; className: string;
  }[];
}

const MODE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque" };

export function FeeCollectionModule({ ctx }: { ctx: ModuleCtx }) {
  const qc = useQueryClient();
  const [recordOpen, setRecordOpen] = useState(false);

  const data = useQuery({
    queryKey: ["payments", "teacher"],
    queryFn: () => api<CollectionPayload>("/api/payments"),
  });

  if (data.isLoading) {
    return (
      <>
        <PageHeader title="Fee Collection" subtitle="Receipts you have collected at the counter." />
        <LoadingGrid count={2} />
        <div className="mt-6"><LoadingRows rows={6} /></div>
      </>
    );
  }
  if (data.isError) return <><PageHeader title="Fee Collection" /><ErrorState message={(data.error as Error).message} /></>;
  const d = data.data!;

  return (
    <>
      <PageHeader
        title="Fee Collection"
        subtitle="Collections recorded here go to the principal for verification."
        actions={
          <Button size="sm" onClick={() => setRecordOpen(true)} disabled={!d.myStudents.length}>
            <Plus className="h-4 w-4" /> Record collection
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Collected this month" value={inr(d.month.total)} icon={ReceiptIndianRupee} tone="primary"
          sub={`${d.month.count} receipt${d.month.count === 1 ? "" : "s"} across your classes`}
        />
        <StatCard
          label="Awaiting verification" value={String(d.month.pending)} icon={Hourglass}
          tone={d.month.pending > 0 ? "warning" : "success"}
          sub={d.month.pending > 0 ? "The principal confirms each counter receipt." : "All your receipts are confirmed."}
        />
      </div>

      <SectionCard className="mt-6" title="My receipts" description="Every fee receipt you have collected, newest first.">
        {d.payments.length === 0 ? (
          <EmptyState
            icon={ReceiptIndianRupee}
            title="No collections yet"
            hint="Use “Record collection” when a student of your class pays at the counter — a receipt number is issued instantly."
          />
        ) : (
          <div className="max-h-[28rem] overflow-y-auto scroll-slim rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-[12.5px]">{p.receiptNo}</TableCell>
                    <TableCell className="font-medium">{p.studentName}</TableCell>
                    <TableCell className="text-muted-foreground">{p.className}</TableCell>
                    <TableCell className="tnum text-right font-medium">{inr(p.amount)}</TableCell>
                    <TableCell>{MODE_LABEL[p.mode] ?? p.mode}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(p.paidOn)}</TableCell>
                    <TableCell><StatusDot status={p.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {d.month.pending === 0 && d.payments.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Every receipt you collected has been verified by the principal.
          </p>
        )}
      </SectionCard>

      <RecordCollectionDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        students={d.myStudents}
        onDone={() => qc.invalidateQueries({ queryKey: ["payments"] })}
      />
    </>
  );
}

function RecordCollectionDialog({
  open, onOpenChange, students, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  students: { id: string; name: string; admissionNo: string; className: string }[];
  onDone: () => void;
}) {
  const [studentId, setStudentId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  const [note, setNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = students.find((s) => s.id === studentId);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((s) => s.name.toLowerCase().includes(needle) || s.admissionNo.toLowerCase().includes(needle));
  }, [students, q]);

  const mutation = useMutation({
    mutationFn: () => api<{ receiptNo: string }>("/api/payments", {
      method: "POST",
      body: JSON.stringify({ studentId, amount: Math.round(Number(amount)), mode, note: note.trim() || undefined }),
    }),
    onSuccess: (d) => {
      toast.success(`Sent to principal for verification — ${d.receiptNo}`);
      setStudentId(null); setAmount(""); setNote(""); setMode("CASH");
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setStudentId(null); setAmount(""); setNote(""); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record collection</DialogTitle>
          <DialogDescription>Students of the classes you teach. The receipt awaits principal verification before it counts as paid.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label>Student</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={pickerOpen} className="w-full justify-between">
                  {selected ? (
                    <span className="flex items-baseline gap-2 truncate">
                      {selected.name}
                      <span className="text-[11.5px] text-muted-foreground">{selected.className}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Search your students…</span>
                  )}
                  <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[340px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Name or admission no…" value={q} onValueChange={setQ} />
                  <CommandList className="scroll-slim">
                    <CommandEmpty>No student found.</CommandEmpty>
                    {filtered.slice(0, 150).map((s) => (
                      <CommandItem
                        key={s.id}
                        value={s.id}
                        onSelect={() => { setStudentId(s.id); setPickerOpen(false); setQ(""); }}
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
          </div>
          <div className="grid gap-2">
            <Label htmlFor="coll-amount">Amount (₹)</Label>
            <Input id="coll-amount" type="number" min={1} placeholder="e.g. 2050" value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" />
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
            <Label htmlFor="coll-note">Note (optional)</Label>
            <Input id="coll-note" placeholder="e.g. October tuition, paid in cash" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={mutation.isPending || !studentId || !amount || Number(amount) < 1}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Recording…" : "Send for verification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
