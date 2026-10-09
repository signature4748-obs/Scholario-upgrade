"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx } from "@/lib/types";
import {
  PageHeader, SectionCard, ErrorState, LoadingRows,
} from "@/components/modules/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Save, Landmark, MapPin, Hash, Globe } from "lucide-react";

interface SettingsPayload {
  id: string;
  name: string;
  slug: string;
  code: string;
  shortName: string | null;
  tagline: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  board: string;
  principalName: string | null;
  established: string | null;
  academicYear: string;
  isDemo: boolean;
  plan: string;
  status: string;
}

interface Draft {
  name: string;
  shortName: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  principalName: string;
  established: string;
  academicYear: string;
}

function toDraft(s: SettingsPayload): Draft {
  return {
    name: s.name ?? "",
    shortName: s.shortName ?? "",
    tagline: s.tagline ?? "",
    address: s.address ?? "",
    city: s.city ?? "",
    phone: s.phone ?? "",
    email: s.email ?? "",
    principalName: s.principalName ?? "",
    established: s.established ?? "",
    academicYear: s.academicYear ?? "",
  };
}

/** Optional fields are cleared to null; name/academicYear always sent. */
function toBody(d: Draft) {
  return {
    name: d.name.trim(),
    academicYear: d.academicYear.trim(),
    shortName: d.shortName.trim() || null,
    tagline: d.tagline.trim() || null,
    address: d.address.trim() || null,
    city: d.city.trim() || null,
    phone: d.phone.trim() || null,
    email: d.email.trim() || null,
    principalName: d.principalName.trim() || null,
    established: d.established.trim() || null,
  };
}

export function SettingsModule({ ctx }: { ctx: ModuleCtx }) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsPayload>("/api/settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (draft: Draft) =>
      api("/api/settings", { method: "PATCH", body: JSON.stringify(toBody(draft)) }),
    onSuccess: () => {
      toast.success("School profile saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["doors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="School Settings" subtitle="How your school appears across Scholario." />
        <LoadingRows rows={10} />
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="School Settings" />
        <ErrorState message={(q.error as Error).message} />
      </>
    );
  }
  const school = q.data!;

  return (
    <>
      <PageHeader
        title="School Settings"
        subtitle="This profile drives the name on the shell, the login door and every printed receipt."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProfileForm
            key={JSON.stringify(toDraft(school))}
            initial={toDraft(school)}
            saving={saveMutation.isPending}
            onSave={(draft) => saveMutation.mutate(draft)}
          />
        </div>

        <SectionCard title="School identity" description="Set at provisioning — read-only.">
          <div className="space-y-3.5">
            <InfoRow icon={Hash} label="School code" value={school.code} mono />
            <InfoRow icon={Globe} label="Web slug" value={school.slug} mono />
            <InfoRow icon={Landmark} label="Board" value={school.board} />
            <InfoRow icon={MapPin} label="Location" value={school.city || "Not set yet"} />
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">Tenant</span>
              {school.isDemo ? (
                <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[11.5px] text-warning-foreground dark:text-warning">
                  Demo tenant
                </Badge>
              ) : (
                <Badge variant="outline" className="border-success/40 bg-success/10 text-[11.5px] text-success">
                  Live tenant
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">Status</span>
              <span className="text-[13px] font-medium">{school.status.toLowerCase()}</span>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className={mono ? "font-mono text-[12.5px] font-medium" : "text-[13px] font-medium"}>{value}</span>
    </div>
  );
}

function ProfileForm({
  initial,
  saving,
  onSave,
}: {
  initial: Draft;
  saving: boolean;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = draft.name.trim().length >= 3 && draft.academicYear.trim().length >= 4;
  const emailOk = draft.email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim());

  return (
    <SectionCard
      title="School profile"
      description="Shown on the sidebar wordmark, login page, receipts and report cards."
      contentClassName="p-4 pt-0"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="set-name">School name</Label>
          <Input id="set-name" value={draft.name} maxLength={140} onChange={set("name")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-short">Short name</Label>
          <Input id="set-short" placeholder="e.g. Hawkings" value={draft.shortName} maxLength={30} onChange={set("shortName")} />
          <p className="text-[11.5px] text-muted-foreground">Used as the sidebar wordmark.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-tagline">Tagline</Label>
          <Input id="set-tagline" placeholder="e.g. Vidya Dadati Vinayam" value={draft.tagline} maxLength={120} onChange={set("tagline")} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="set-address">Address</Label>
          <Input id="set-address" placeholder="Street, locality, landmark" value={draft.address} maxLength={200} onChange={set("address")} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="set-city">City / district</Label>
          <Input id="set-city" placeholder="e.g. Distt. Niwari, Madhya Pradesh — 472336" value={draft.city} maxLength={80} onChange={set("city")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-phone">Phone</Label>
          <Input id="set-phone" placeholder="07578 265432" value={draft.phone} maxLength={20} onChange={set("phone")} className="tnum" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-email">Office email</Label>
          <Input id="set-email" type="email" placeholder="office@hhsp.edu.in" value={draft.email} maxLength={120} onChange={set("email")} />
          {!emailOk && <p className="text-[11.5px] text-destructive">Enter a valid email address.</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-principal">Principal&rsquo;s name</Label>
          <Input id="set-principal" placeholder="e.g. Arjun Malhotra" value={draft.principalName} maxLength={80} onChange={set("principalName")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-established">Established</Label>
          <Input id="set-established" placeholder="e.g. 2004" value={draft.established} maxLength={10} onChange={set("established")} className="tnum" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="set-ay">Academic year</Label>
          <Input id="set-ay" placeholder="e.g. 2026-27" value={draft.academicYear} maxLength={12} onChange={set("academicYear")} className="tnum" />
        </div>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <Button
            disabled={!dirty || !valid || !emailOk || saving}
            onClick={() => onSave(draft)}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
