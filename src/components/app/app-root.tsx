"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type MeDTO } from "@/lib/types";
import { LoginView } from "@/components/app/login-view";
import { AppShell } from "@/components/app/app-shell";
import { useHashRoute } from "@/components/app/use-hash-route";
import { Crest } from "@/components/app/crest";

export function AppRoot() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: MeDTO | null }>("/api/auth/me"),
  });
  const doorsQuery = useQuery({
    queryKey: ["doors"],
    queryFn: () => api<{ schools: any[] }>("/api/auth/schools"),
    staleTime: 5 * 60_000,
  });

  const [module, go] = useHashRoute("dashboard");
  const me = meQuery.data?.user ?? null;

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <Crest className="h-12 w-12 text-lg" letter="S" />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="crest-grad h-full w-1/2 animate-pulse" />
        </div>
        <p className="text-xs text-muted-foreground">Opening your desk…</p>
      </div>
    );
  }

  if (!me) {
    if (doorsQuery.isLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      );
    }
    return (
      <LoginView
        doors={doorsQuery.data?.schools ?? []}
        onAuthed={() => {
          meQuery.refetch();
        }}
      />
    );
  }

  return <AppShell me={me} activeModule={module} go={go} />;
}
