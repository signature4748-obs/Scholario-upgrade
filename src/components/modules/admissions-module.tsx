"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { fmtDate, timeAgo } from "@/lib/format";
import {
  PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid,
} from "@/components/modules/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  UserPlus, Sparkles, PhoneCall, CalendarClock, FileText, X, ChevronRight, Inbox, KeyRound,
} from "lucide-react";

interface Inquiry {
  id: string; applicantName: string; classSought: string; parentName: string;
  phone: string; email: string | null; source: string; status: string;
  note: string | null; followUpOn: string | null; createdAt: string;
  credentials?: { admissionNo: string; email: string; password: string; className: string; rollNo: number };
}
interface AdmissionsPayload {
  inquiries: Inquiry[];
  statusCounts: Record<string, number>;
  classOptions: string[];
  total: number;
}

const STATUS_LABEL: Record<string, string> = {
  NEW: "New", CONTACTED: "Contacted", VISIT_SCHEDULED: "Visit scheduled",
  APPLICATION: "Application", ENROLLED: "Enrolled", CLOSED: "Closed",
};
const NEXT_STATUS: Record<string, { to: string; label: string }[]> = {
  NEW: [{ to: "CONTACTED", label: "Mark contacted" }],
  CONTACTED: [{ to: "VISIT_SCHEDULED", label: "Schedule visit" }],
  VISIT_SCHEDULED: [{ to: "APPLICATION", label: "Mark application" }],
  APPLICATION: [{ to: "ENROLLED", label: "Enrol" }],
};
const SOURCE_LABEL: Record<string, string> = { WALK_IN: "Walk-in", WEBSITE: "Website", PHONE: "Phone", REFERRAL: "Referral" };

function StatusBadge({ status }: { status: string }) {
  if (status === "ENROLLED") return <Badge className="bg-success/15 text-success hover:bg-success/15">Enrolled</Badge>;
  if (status === "CLOSED") return <Badge variant="outline" className="text-muted-foreground">Closed</Badge>;
  if (status === "APPLICATION") return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Application</Badge>;
  return <Badge variant="secondary">{STATUS_LABEL[status] ?? status}</Badge>;
}

export function AdmissionsModule({ ctx }: { ctx: ModuleCtx }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [newOpen, setNewOpen] = useState(false);
  const [enrolled, setEnrolled] = useState<Inquiry | null>(null);

  const data = useQuery({
    queryKey: ["admissions", statusFilter],
    queryFn: () => api<AdmissionsPayload>(`/api/admissions${statusFilter !== "ALL" ? `?status=${statusFilter}` : ""}`),
  });

  const advance = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api<Inquiry>("/api/admissions", { method: "PATCH", body: JSON.stringify(v) }),
    onSuccess: (updated, vars) => {
      if (vars.status === "ENROLLED") {
        setEnrolled(updated);
        toast.success(`${updated.applicantName} enrolled — ${updated.credentials?.className ?? updated.classSought}`);
      } else {
        toast.success(`${updated.applicantName} — ${STATUS_LABEL[updated.status]?.toLowerCase() ?? updated.status.toLowerCase()}`);
      }
      qc.invalidateQueries({ queryKey: ["admissions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = data.data?.statusCounts ?? {};

  return (
    <>
      <PageHeader
        title="Admissions"
        subtitle="Inquiry inbox for the current session."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <UserPlus className="h-4 w-4" /> New inquiry
          </Button>
        }
      />

      {data.isLoading ? (
        <LoadingGrid count={4} />
      ) : data.isError ? (
        <ErrorState message={(data.error as Error).message} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="New" value={String(counts.NEW ?? 0)} icon={Sparkles} tone="info" />
          <StatCard label="Contacted" value={String(counts.CONTACTED ?? 0)} icon={PhoneCall} />
          <StatCard label="Visits scheduled" value={String(counts.VISIT_SCHEDULED ?? 0)} icon={CalendarClock} />
          <StatCard label="Applications" value={String(counts.APPLICATION ?? 0)} icon={FileText} tone="primary" />
        </div>
      )}

      <SectionCard
        className="mt-6"
        title="Inquiries"
        description={`${data.data?.total ?? 0} inquiries this session — advance each one through the pipeline, or close it out.`}
        actions={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {Object.keys(STATUS_LABEL).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {data.isLoading ? (
          <LoadingRows rows={6} />
        ) : data.isError ? (
          <ErrorState message={(data.error as Error).message} />
        ) : data.data!.inquiries.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={statusFilter === "ALL" ? "No inquiries yet" : `No ${STATUS_LABEL[statusFilter]?.toLowerCase() ?? statusFilter.toLowerCase()} inquiries`}
            hint="Walk-ins, website forms, phone calls and referrals all land here."
          />
        ) : (
          <div className="max-h-[30rem] overflow-y-auto scroll-slim rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Class sought</TableHead>
                  <TableHead className="hidden lg:table-cell">Parent</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead className="hidden xl:table-cell">Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Follow-up</TableHead>
                  <TableHead className="hidden sm:table-cell">Received</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data!.inquiries.map((iq) => {
                  const next = NEXT_STATUS[iq.status];
                  const live = iq.status !== "ENROLLED" && iq.status !== "CLOSED";
                  return (
                    <TableRow key={iq.id} className={iq.status === "ENROLLED" ? "bg-success/[0.04]" : undefined}>
                      <TableCell>
                        <div className="font-medium">{iq.applicantName}</div>
                        {iq.note && <div className="max-w-56 truncate text-[11.5px] text-muted-foreground" title={iq.note}>{iq.note}</div>}
                      </TableCell>
                      <TableCell>{iq.classSought}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{iq.parentName}</TableCell>
                      <TableCell className="hidden md:table-cell tnum text-muted-foreground">{iq.phone}</TableCell>
                      <TableCell className="hidden xl:table-cell"><Badge variant="outline">{SOURCE_LABEL[iq.source] ?? iq.source}</Badge></TableCell>
                      <TableCell><StatusBadge status={iq.status} /></TableCell>
                      <TableCell className="hidden md:table-cell tnum text-muted-foreground">{iq.followUpOn ? fmtDate(iq.followUpOn) : "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{timeAgo(iq.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {next?.map((n) => (
                            <Button
                              key={n.to}
                              size="sm"
                              variant={n.to === "ENROLLED" ? "default" : "outline"}
                              disabled={advance.isPending}
                              onClick={() => advance.mutate({ id: iq.id, status: n.to })}
                            >
                              {n.label} <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          ))}
                          {live && (
                            <Button
                              size="sm" variant="ghost" className="text-muted-foreground"
                              disabled={advance.isPending}
                              onClick={() => advance.mutate({ id: iq.id, status: "CLOSED" })}
                              aria-label={`Close inquiry for ${iq.applicantName}`}
                              title="Close inquiry"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <NewInquiryDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        classOptions={data.data?.classOptions ?? []}
        onCreated={() => qc.invalidateQueries({ queryKey: ["admissions"] })}
      />

      <AlertDialog open={!!enrolled} onOpenChange={(o) => !o && setEnrolled(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              {enrolled?.applicantName} is enrolled
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  Added to {enrolled?.credentials?.className} as roll no. {enrolled?.credentials?.rollNo}. Share these
                  credentials with the parent — shown only once.
                </p>
                <div className="mt-3 grid gap-1.5 rounded-lg border bg-muted/40 p-3 font-mono text-[12.5px]">
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Admission no.</span><span className="tnum font-semibold">{enrolled?.credentials?.admissionNo}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Email</span><span className="font-semibold">{enrolled?.credentials?.email}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Password</span><span className="font-semibold">{enrolled?.credentials?.password}</span></div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setEnrolled(null)}>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NewInquiryDialog({
  open, onOpenChange, classOptions, onCreated,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  classOptions: string[]; onCreated: () => void;
}) {
  const [applicantName, setApplicantName] = useState("");
  const [classSought, setClassSought] = useState("");
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("WALK_IN");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => api("/api/admissions", {
      method: "POST",
      body: JSON.stringify({
        applicantName, classSought, parentName, phone,
        email: email.trim() || undefined, source, note: note.trim() || undefined,
      }),
    }),
    onSuccess: () => {
      toast.success(`Inquiry recorded — ${classSought} (${applicantName}, ${SOURCE_LABEL[source]?.toLowerCase() ?? source.toLowerCase()})`);
      setApplicantName(""); setClassSought(""); setParentName(""); setPhone(""); setEmail(""); setNote(""); setSource("WALK_IN");
      onOpenChange(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = applicantName.trim().length >= 2 && classSought && parentName.trim().length >= 2 && phone.trim().length >= 6;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New inquiry</DialogTitle>
          <DialogDescription>Log every walk-in, call and website lead — follow-ups land on the inbox.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inq-name">Applicant name</Label>
              <Input id="inq-name" placeholder="e.g. Aarohi Nigam" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Class sought</Label>
              <Select value={classSought} onValueChange={setClassSought}>
                <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
                <SelectContent className="max-h-64 scroll-slim">
                  {classOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inq-parent">Parent / guardian</Label>
              <Input id="inq-parent" placeholder="e.g. Smt. Rekha Nigam" value={parentName} onChange={(e) => setParentName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inq-phone">Phone</Label>
              <Input id="inq-phone" placeholder="+91 …" value={phone} onChange={(e) => setPhone(e.target.value)} className="tnum" />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inq-email">Email (optional)</Label>
              <Input id="inq-email" type="email" placeholder="parent@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inq-note">Note (optional)</Label>
            <Textarea id="inq-note" rows={2} placeholder="Anything worth remembering — transfer case, transport route, sibling…"
              value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mutation.isPending || !valid} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Recording…" : "Record inquiry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
