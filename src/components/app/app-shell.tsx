"use client";

import { lazy, Suspense, useMemo } from "react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { api, type MeDTO, type ModuleCtx } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Wordmark } from "@/components/app/crest";
import { MODULES, MODULE_GROUPS } from "@/components/modules/registry";
import { initials } from "@/lib/format";
import { LogOut, Menu, Moon, Sun, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const roleLabel: Record<string, string> = {
  PRINCIPAL: "Principal",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

export function AppShell({ me, activeModule, go }: { me: MeDTO; activeModule: string; go: (m: string) => void }) {
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();

  const nav = useMemo(() => MODULES.filter((m) => m.roles.includes(me.role)), [me.role]);
  const groups = useMemo(() => MODULE_GROUPS.filter((g) => g.modules.some((id) => nav.some((n) => n.id === id))), [nav]);
  const active = nav.find((m) => m.id === activeModule) ?? nav[0];
  const ctx: ModuleCtx = useMemo(() => ({ me, go }), [me, go]);

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      window.location.hash = "";
      window.location.reload();
    },
    onError: () => toast.error("Couldn't sign out. Try again."),
  });

  const navContent = (onNavigate?: () => void) => (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3.5 pb-4 scroll-slim" aria-label="Modules">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.modules
              .map((id) => nav.find((n) => n.id === id))
              .filter(Boolean)
              .map((m) => {
                const Icon = m!.icon;
                const isActive = active?.id === m!.id;
                return (
                  <button
                    key={m!.id}
                    onClick={() => {
                      go(m!.id);
                      onNavigate?.();
                    }}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                    <span className="truncate">{m!.title}</span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );

  const ActiveComponent = active?.component;

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Wordmark short={me.school.shortName || me.school.name.split(" ")[0]} />
        </div>
        <div className="flex-1 overflow-hidden pt-4">{navContent()}</div>
        <div className="border-t p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                {initials(me.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium">{me.name}</div>
              <div className="text-[11px] text-muted-foreground">{roleLabel[me.role]}</div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => logout.mutate()} title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          {/* Mobile nav */}
          <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex h-14 items-center border-b px-4">
                  <Wordmark short={me.school.shortName || me.school.name.split(" ")[0]} />
                </div>
                <div className="h-[calc(100%-3.5rem)] pt-4">{navContent()}</div>
              </SheetContent>
            </Sheet>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-[15px] font-semibold tracking-tight">{active?.title}</h1>
          </div>

          {me.school.isDemo && (
            <Badge variant="outline" className="hidden gap-1.5 border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 sm:inline-flex">
              Demo tenant
            </Badge>
          )}
          <div className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] text-muted-foreground md:flex">
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="tnum">Session {me.school.academicYear}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full outline-none ring-ring/40 focus-visible:ring-2" aria-label="Account menu">
                <Avatar className="h-8 w-8 border">
                  <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">{initials(me.name)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="leading-tight">
                  <div className="text-[13px] font-medium">{me.name}</div>
                  <div className="truncate text-[11px] font-normal text-muted-foreground">{me.email}</div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[13px]" onClick={() => go("settings")}>
                School settings
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[13px]" onClick={() => go("profile")}>
                My profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[13px] text-destructive focus:text-destructive" onClick={() => logout.mutate()}>
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main id="module-scroll" className="flex-1 overflow-y-auto scroll-slim" tabIndex={-1}>
          <motion.div
            key={active?.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8"
          >
            <Suspense fallback={<ModuleSkeleton />}>
              {ActiveComponent ? <ActiveComponent ctx={ctx} /> : null}
            </Suspense>
          </motion.div>
        </main>
      </div>
    </div>
  );
}

function ModuleSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
