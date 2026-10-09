"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ModuleCtx, type Role } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PageHeader, SectionCard, EmptyState, ErrorState, LoadingRows,
} from "@/components/modules/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Megaphone, Pin, PinOff, Plus, Trash2 } from "lucide-react";

interface NoticeRow {
  id: string;
  title: string;
  body: string;
  audience: string;
  pinned: boolean;
  publishedAt: string;
  postedById: string | null;
  postedBy: string | null;
}

interface NoticesPayload {
  role: Role;
  notices: NoticeRow[];
}

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: "Everyone",
  TEACHERS: "Teachers",
  STUDENTS: "Students",
};

export function NoticesModule({ ctx }: { ctx: ModuleCtx }) {
  const qc = useQueryClient();
  const [postOpen, setPostOpen] = useState(false);
  const [deleting, setDeleting] = useState<NoticeRow | null>(null);

  const q = useQuery({
    queryKey: ["notices"],
    queryFn: () => api<NoticesPayload>("/api/notices"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notices"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const pinMutation = useMutation({
    mutationFn: (n: NoticeRow) =>
      api("/api/notices", { method: "PATCH", body: JSON.stringify({ id: n.id, pinned: !n.pinned }) }),
    onSuccess: (_data, n) => {
      toast.success(n.pinned ? `Unpinned — ${n.title}` : `Pinned to the top — ${n.title}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (n: NoticeRow) => api(`/api/notices?id=${encodeURIComponent(n.id)}`, { method: "DELETE" }),
    onSuccess: (_data, n) => {
      toast.success(`Notice removed — ${n.title}`);
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPrincipal = ctx.me.role === "PRINCIPAL";
  const subtitle = isPrincipal
    ? "Announcements for staff, students and guardians — pinned notices stay on top."
    : ctx.me.role === "TEACHER"
      ? "Circulars and staff announcements from the school office."
      : "Circulars from the school office and your teachers.";

  return (
    <>
      <PageHeader
        title="Notices"
        subtitle={subtitle}
        actions={
          isPrincipal ? (
            <Button size="sm" onClick={() => setPostOpen(true)}>
              <Plus className="h-4 w-4" /> Post notice
            </Button>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <LoadingRows rows={5} />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} />
      ) : q.data!.notices.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No notices on the board yet"
          hint={
            isPrincipal
              ? "Post the first announcement — pick the audience so it reaches the right people."
              : "Nothing addressed to you right now. New circulars from the office will appear here."
          }
          action={
            isPrincipal ? (
              <Button size="sm" variant="outline" onClick={() => setPostOpen(true)}>
                <Plus className="h-4 w-4" /> Post the first notice
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SectionCard
          title="Notice board"
          description={`${q.data!.notices.length} notice${q.data!.notices.length > 1 ? "s" : ""} for you — pinned first.`}
          contentClassName="p-4 pt-0"
        >
          <ul className="space-y-3">
            {q.data!.notices.map((n) => (
              <li
                key={n.id}
                className={cn("rounded-xl border p-4", n.pinned && "border-primary/40 bg-primary/[0.035]")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    {n.pinned && <Pin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Pinned" />}
                    <h3 className="text-[14px] font-semibold leading-snug tracking-tight">{n.title}</h3>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-muted-foreground">
                    {AUDIENCE_LABEL[n.audience] ?? n.audience}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">{n.body}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                  <p className="text-[11.5px] text-muted-foreground/80">
                    {n.postedBy ? `Posted by ${n.postedBy}` : "School office"} · {timeAgo(n.publishedAt)}
                  </p>
                  {isPrincipal && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-[12px]"
                        disabled={pinMutation.isPending}
                        onClick={() => pinMutation.mutate(n)}
                      >
                        {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        {n.pinned ? "Unpin" : "Pin"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-[12px] text-destructive hover:text-destructive"
                        onClick={() => setDeleting(n)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {isPrincipal && (
        <PostNoticeDialog open={postOpen} onOpenChange={setPostOpen} onPosted={invalidate} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this notice?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span className="font-medium text-foreground">{deleting?.title}</span> will be taken off the board
                for everyone it was addressed to. This cannot be undone.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting);
              }}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove notice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PostNoticeDialog({
  open,
  onOpenChange,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPosted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL");
  const [pinned, setPinned] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/notices", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), audience, pinned }),
      }),
    onSuccess: () => {
      toast.success(`Notice published — ${title.trim()}`);
      setTitle("");
      setBody("");
      setAudience("ALL");
      setPinned(false);
      onOpenChange(false);
      onPosted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = title.trim().length >= 3 && body.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post a notice</DialogTitle>
          <DialogDescription>
            Choose the audience carefully — the notice reaches exactly those accounts.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="notice-title">Title</Label>
            <Input
              id="notice-title"
              placeholder="e.g. Winter uniform from 1 November"
              value={title}
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notice-body">Body</Label>
            <Textarea
              id="notice-body"
              rows={6}
              placeholder="Dates, timings, instructions — line breaks are kept as written."
              value={body}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone</SelectItem>
                  <SelectItem value="TEACHERS">Teachers</SelectItem>
                  <SelectItem value="STUDENTS">Students</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 sm:mt-7">
              <div className="space-y-0.5">
                <Label htmlFor="notice-pinned" className="text-[13px]">Pin to top</Label>
                <p className="text-[11.5px] text-muted-foreground">Stays first on the board</p>
              </div>
              <Switch id="notice-pinned" checked={pinned} onCheckedChange={setPinned} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Publishing…" : "Publish notice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
