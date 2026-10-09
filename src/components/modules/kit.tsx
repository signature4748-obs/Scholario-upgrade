"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { AlertCircle } from "lucide-react";

/** Consistent module page header. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "default" | "primary" | "success" | "warning" | "destructive" | "info";

const toneClasses: Record<Tone, string> = {
  default: "bg-muted text-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

/** KPI stat card used across dashboards and finance modules. */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
          {Icon && (
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", toneClasses[tone])}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <div className="tnum mt-1.5 font-display text-[22px] font-semibold leading-none tracking-tight">{value}</div>
        {sub && <div className="mt-2 text-[12px] leading-snug text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/** Section card with optional title row. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-[14.5px] font-semibold tracking-tight">{title}</CardTitle>
              {description && <CardDescription className="mt-0.5 text-[12.5px]">{description}</CardDescription>}
            </div>
            {actions}
          </div>
        </CardHeader>
      )}
      <CardContent className={cn(title || actions ? "pt-0" : "p-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
      {Icon && <Icon className="h-5 w-5 text-muted-foreground/60" />}
      <div className="mt-2.5 text-sm font-medium">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function LoadingGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

/** Status dot + label for attendance / payment states. */
export function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    PRESENT: "bg-success",
    ABSENT: "bg-destructive",
    LATE: "bg-warning",
    LEAVE: "bg-info",
    SUCCESS: "bg-success",
    UNDER_VERIFICATION: "bg-warning",
    REJECTED: "bg-destructive",
    DUE: "bg-warning",
    PAID: "bg-success",
    WAIVED: "bg-muted-foreground/40",
    ACTIVE: "bg-success",
    SUSPENDED: "bg-destructive",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", map[status] ?? "bg-muted-foreground/50")} />
      <span className="text-[12.5px] capitalize">{status.toLowerCase().replace(/_/g, " ")}</span>
    </span>
  );
}
