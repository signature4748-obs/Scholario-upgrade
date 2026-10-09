"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import { PageHeader, StatCard, EmptyState, ErrorState, LoadingGrid, StatusDot } from "@/components/modules/kit";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Search, UserPlus, GraduationCap, BookOpenCheck, Layers, Banknote, Loader2, Mail, Phone, KeyRound,
} from "lucide-react";
import { inr, fmtDate, initials, avatarTint } from "@/lib/format";

interface TeacherCard {
  id: string; name: string; email: string; designation: string; employeeCode: string;
  specialization: string | null; qualification: string | null; phone: string | null;
  monthlySalary: number; joinedOn: string | null; status: string;
  subjectsCount: number; classTeacherOf: number;
}
interface TeachersData {
  teachers: TeacherCard[];
  subjectCodes: { code: string; name: string }[];
}

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function TeachersModule({ ctx }: { ctx: ModuleCtx }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);

  const listQ = useQuery({
    queryKey: ["teachers", { q }],
    queryFn: () => api<TeachersData>(`/api/teachers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  const data = listQ.data;
  const teachers = data?.teachers ?? [];
  const payroll = useMemo(() => teachers.reduce((t, x) => t + x.monthlySalary, 0), [teachers]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teachers"
        subtitle={`${ctx.me.school.shortName ?? ctx.me.school.name} · teaching staff of ${teachers.length}`}
        actions={
          <Button size="sm" onClick={() => { setAddKey((k) => k + 1); setAddOpen(true); }}>
            <UserPlus className="h-3.5 w-3.5" /> Add teacher
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Teaching staff" value={teachers.length} sub="active this session" icon={GraduationCap} tone="primary" />
        <StatCard label="Monthly payroll" value={inr(payroll, { compact: true })} sub="gross, fixed salaries" icon={Banknote} tone="success" />
        <StatCard
          label="Section leads"
          value={teachers.filter((t) => t.classTeacherOf > 0).length}
          sub="teachers leading a home room"
          icon={Layers}
        />
      </div>

      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, code or subject…"
          aria-label="Search teachers"
          className="h-9 pl-8"
        />
      </div>

      {listQ.isLoading ? (
        <LoadingGrid count={6} />
      ) : listQ.isError ? (
        <ErrorState message={(listQ.error as Error)?.message ?? "Couldn't load the staff directory."} />
      ) : teachers.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={q ? `No teacher matches “${q}”` : "No teachers on record"}
          hint={q ? "Try a different spelling, or search by employee code (HHSP-T-…) or subject." : "Add your first teacher to build the timetable and subject allocations."}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teachers.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-xs">
              <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback style={{ background: avatarTint(t.name) }} className="text-[13px] font-semibold text-foreground/70">
                    {initials(t.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-[14px] font-semibold leading-tight">{t.name}</div>
                    <StatusDot status={t.status} />
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-muted-foreground">{t.designation}</div>
                  <div className="tnum mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="h-5 bg-muted text-[11px]">{t.employeeCode}</Badge>
                    {t.specialization && (
                      <Badge variant="secondary" className="h-5 bg-primary/10 text-[11px] text-primary">{t.specialization}</Badge>
                    )}
                  </div>
                </div>
              </div>

              {t.qualification && (
                <p className="mt-3 truncate text-[12.5px] text-muted-foreground" title={t.qualification}>{t.qualification}</p>
              )}

              <div className="mt-3 space-y-1 text-[12.5px] text-muted-foreground">
                <div className="flex items-center gap-2 truncate">
                  <Mail className="h-3 w-3 shrink-0" /> {t.email}
                </div>
                {t.phone && (
                  <div className="tnum flex items-center gap-2">
                    <Phone className="h-3 w-3 shrink-0" /> {t.phone}
                  </div>
                )}
              </div>

              <div className="mt-3.5 grid grid-cols-3 divide-x rounded-lg border bg-muted/25 py-2 text-center">
                <div>
                  <div className="tnum font-display text-[15px] font-semibold leading-none">{t.subjectsCount}</div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">subjects</div>
                </div>
                <div>
                  <div className="tnum font-display text-[15px] font-semibold leading-none">{t.classTeacherOf}</div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">home rooms</div>
                </div>
                <div>
                  <div className="tnum font-display text-[15px] font-semibold leading-none">{inr(t.monthlySalary, { compact: true })}</div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">per month</div>
                </div>
              </div>
              {t.joinedOn && (
                <div className="tnum mt-2.5 flex items-center justify-between text-[11.5px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><BookOpenCheck className="h-3 w-3" /> joined {fmtDate(t.joinedOn)}</span>
                  <span>{inr(t.monthlySalary)}/mo</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AddTeacherDialog key={addKey} open={addOpen} onOpenChange={setAddOpen} subjectCodes={data?.subjectCodes ?? []} />
    </div>
  );
}

/* ── add teacher dialog ─────────────────────────────────────────── */

function AddTeacherDialog({
  open, onOpenChange, subjectCodes,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectCodes: { code: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", email: "", designation: "", qualification: "", specialization: "", phone: "", monthlySalary: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ employeeCode: string }>("/api/teachers", {
        method: "POST",
        body: JSON.stringify({ ...form, monthlySalary: Number(form.monthlySalary) }),
      }),
    onSuccess: (d) => {
      toast.success(`${form.name.trim()} joined — employee code ${d.employeeCode}`);
      qc.invalidateQueries({ queryKey: ["teachers"] });
      onOpenChange(false);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const salary = Number(form.monthlySalary);
  const valid =
    form.name.trim().length >= 3 &&
    /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
    form.designation.trim().length >= 2 &&
    !!form.specialization &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    Number.isFinite(salary) && salary > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a teacher</DialogTitle>
          <DialogDescription>
            The employee code (HHSP-T-0NN) is assigned automatically. Password defaults to the school's standard.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) {
              setFormError("Fill in name, email, designation, subject, a 10-digit phone and a monthly salary.");
              return;
            }
            setFormError(null);
            create.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Full name</Label>
              <Input id="t-name" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Meera Nair" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-email">Email</Label>
              <Input id="t-email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="meera.nair@hhsp.edu.in" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-desig">Designation</Label>
              <Input id="t-desig" value={form.designation} onChange={(e) => set("designation")(e.target.value)} placeholder="e.g. Teacher (TGT)" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-subj">Specialization</Label>
              <Select value={form.specialization} onValueChange={set("specialization")}>
                <SelectTrigger id="t-subj" className="w-full">
                  <SelectValue placeholder="Pick a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjectCodes.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-qual">Qualification</Label>
              <Input id="t-qual" value={form.qualification} onChange={(e) => set("qualification")(e.target.value)} placeholder="e.g. M.Sc. Physics, B.Ed." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-phone">Phone</Label>
              <Input id="t-phone" value={form.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+91 98123 45678" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-salary">Monthly salary (₹)</Label>
            <Input id="t-salary" type="number" min={1} value={form.monthlySalary} onChange={(e) => set("monthlySalary")(e.target.value)} placeholder="38000" />
          </div>

          {formError && <ErrorState message={formError} />}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !valid}>
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add teacher
            </Button>
          </DialogFooter>
        </form>

        <p className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
          <KeyRound className="h-3 w-3 shrink-0" />
          They sign in with this email and the standard school password, which can be changed after first login.
        </p>
      </DialogContent>
    </Dialog>
  );
}
