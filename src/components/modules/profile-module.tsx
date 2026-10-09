"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type ModuleCtx } from "@/lib/types";
import { fmtDate, inr, initials, avatarTint } from "@/lib/format";
import {
  PageHeader, StatCard, SectionCard, EmptyState, ErrorState, LoadingRows, LoadingGrid,
} from "@/components/modules/kit";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CalendarCheck2, GraduationCap, IdCard, Wallet, UserRound, Phone, MapPin, Mail, Cake, User, DoorOpen, Users,
} from "lucide-react";

interface ProfilePayload {
  student: {
    name: string;
    admissionNo: string;
    rollNo: number;
    gender: string | null;
    dob: string | null;
    admittedOn: string;
    guardianName: string | null;
    guardianPhone: string | null;
    address: string | null;
    email: string;
  };
  class: {
    name: string;
    classTeacher: string | null;
    classTeacherDesignation: string | null;
    room: string | null;
    strength: number;
  };
  attendance: {
    pct: number | null;
    counts: { PRESENT: number; ABSENT: number; LATE: number; LEAVE: number };
    considered: number;
  };
  fees: { totalDue: number; dueCount: number };
}

export function ProfileModule({ ctx }: { ctx: ModuleCtx }) {
  const q = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<ProfilePayload>("/api/profile"),
  });

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="My Profile" subtitle="Your record as held in the school register." />
        <LoadingGrid count={2} />
        <div className="mt-6">
          <LoadingRows rows={6} />
        </div>
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="My Profile" />
        <ErrorState message={(q.error as Error).message} />
      </>
    );
  }
  const d = q.data!;
  const s = d.student;

  return (
    <>
      <PageHeader
        title="My Profile"
        subtitle={`Your record in the ${ctx.me.school.name} register — as maintained by the school office.`}
      />

      {/* identity card */}
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl font-display text-lg font-semibold text-foreground/80"
            style={{ backgroundColor: avatarTint(s.name) }}
            aria-hidden
          >
            {initials(s.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold tracking-tight">{s.name}</h3>
              <Badge variant="secondary" className="text-[11.5px]">{ctx.me.school.code} student</Badge>
            </div>
            <p className="mt-1 font-mono text-[12.5px] text-muted-foreground">{s.admissionNo}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Badge variant="outline" className="gap-1.5 text-[12px] font-normal">
              <GraduationCap className="h-3.5 w-3.5" /> {d.class.name}
            </Badge>
            <Badge variant="outline" className="gap-1.5 text-[12px] font-normal tnum">
              <UserRound className="h-3.5 w-3.5" /> Roll {s.rollNo}
            </Badge>
          </div>
        </div>

        <Separator className="my-5" />

        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail icon={Cake} label="Date of birth" value={s.dob ? fmtDate(s.dob) : "Not recorded"} />
          <Detail icon={User} label="Guardian" value={s.guardianName || "Not recorded"} />
          <Detail icon={Phone} label="Guardian phone" value={s.guardianPhone || "Not recorded"} tnum />
          <Detail icon={MapPin} label="Address" value={s.address || "Not recorded"} />
          <Detail icon={Mail} label="Login email" value={s.email} />
          <Detail icon={IdCard} label="Admitted on" value={fmtDate(s.admittedOn)} />
        </dl>
      </div>

      {/* quick stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Attendance this session"
          value={d.attendance.pct != null ? `${d.attendance.pct}%` : "—"}
          sub={
            d.attendance.considered > 0
              ? `${d.attendance.considered} school days · ${d.attendance.counts.ABSENT} absent · ${d.attendance.counts.LATE} late`
              : "No attendance recorded yet"
          }
          icon={CalendarCheck2}
          tone={d.attendance.pct != null && d.attendance.pct >= 75 ? "success" : "default"}
        />
        <StatCard
          label="Fee dues"
          value={inr(d.fees.totalDue)}
          sub={
            d.fees.dueCount > 0
              ? `${d.fees.dueCount} pending instalment${d.fees.dueCount > 1 ? "s" : ""} — clear at the school office`
              : "All assessed fees are cleared"
          }
          icon={Wallet}
          tone={d.fees.totalDue > 0 ? "warning" : "success"}
        />
      </div>

      {/* my class */}
      {d.class.name ? (
        <SectionCard
          className="mt-6"
          title="My class"
          description="Your section and the teacher responsible for it."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Detail icon={GraduationCap} label="Class" value={d.class.name} />
            <Detail
              icon={Users}
              label="Class teacher"
              value={
                d.class.classTeacher
                  ? `${d.class.classTeacher}${d.class.classTeacherDesignation ? ` · ${d.class.classTeacherDesignation}` : ""}`
                  : "Not assigned yet"
              }
            />
            <Detail icon={DoorOpen} label="Room" value={d.class.room || "—"} />
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground">
            {d.class.strength} students are on the {d.class.name} roll.
          </p>
        </SectionCard>
      ) : (
        <div className="mt-6">
          <EmptyState title="No class assigned" hint="The office has not placed you in a section yet." />
        </div>
      )}
    </>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  tnum,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tnum?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0">
        <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground/70">{label}</dt>
        <dd className={`mt-0.5 break-words text-[13.5px] font-medium ${tnum ? "tnum" : ""}`}>{value}</dd>
      </div>
    </div>
  );
}
