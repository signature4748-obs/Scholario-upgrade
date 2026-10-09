"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Crest } from "@/components/app/crest";
import { api, type SchoolDTO } from "@/lib/types";
import { Loader2, LockKeyhole, Mail, ShieldCheck, BookOpenCheck, LineChart } from "lucide-react";

const DEMO_LOGINS = [
  { label: "Principal", email: "arjun.malhotra@hhsp.edu.in", hint: "Arjun Malhotra" },
  { label: "Teacher", email: "sunita.verma@hhsp.edu.in", hint: "Sunita Verma · Class 10-A" },
  { label: "Student", email: "ananya.sharma.25@students.hhsp.edu.in", hint: "Ananya Sharma · Class 10-A" },
];

export function LoginView({ doors, onAuthed }: { doors: SchoolDTO[]; onAuthed: () => void }) {
  const demo = doors.find((d) => d.isDemo);
  const [schoolSlug, setSchoolSlug] = useState(doors[0]?.slug ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: async () => {
      return api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    },
    onSuccess: () => {
      toast.success("Welcome back.");
      onAuthed();
    },
    onError: (e: Error) => setError(e.message),
  });

  const selectedDoor = doors.find((d) => d.slug === schoolSlug);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Brand panel */}
        <div className="crest-grad relative hidden w-[46%] flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14">
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/10 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <Crest className="h-10 w-10 text-[15px]" letter="H" />
            <div>
              <div className="font-display text-lg font-semibold tracking-tight">Scholario</div>
              <div className="text-xs text-white/70">School Operating System</div>
            </div>
          </div>

          <div className="relative max-w-md">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
              <p className="font-display text-3xl font-semibold leading-snug tracking-tight xl:text-4xl">
                A quiet, reliable desk for the whole school.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-white/80">
                Attendance at 8:40, marks by Friday, fees with receipts that reconcile, and a timetable
                that never double-books a room or a teacher.
              </p>
            </motion.div>
            <div className="mt-10 grid grid-cols-3 gap-3 text-[13px]">
              {[
                { icon: BookOpenCheck, label: "Attendance & marks" },
                { icon: LineChart, label: "Fees & ledgers" },
                { icon: ShieldCheck, label: "Verified receipts" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
                  <Icon className="h-4 w-4 text-white/85" />
                  <div className="mt-2 leading-snug text-white/85">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative text-xs text-white/60">
            {demo ? (
              <span>
                {demo.name} · Est. {demo.established} · {demo.city}
              </span>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
        </div>

        {/* Form panel */}
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-[420px]"
          >
            <div className="mb-8 lg:hidden">
              <Crest className="h-12 w-12 text-lg" letter="H" />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use your school email. Sessions stay signed in for two weeks.
            </p>

            <form
              className="mt-8 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                login.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="school">School</Label>
                <Select value={schoolSlug} onValueChange={(v) => setSchoolSlug(v)}>
                  <SelectTrigger id="school" className="w-full">
                    <SelectValue placeholder="Choose your school" />
                  </SelectTrigger>
                  <SelectContent>
                    {doors.map((d) => (
                      <SelectItem key={d.slug} value={d.slug}>
                        <span className="flex items-center gap-2">
                          {d.name}
                          {d.isDemo && (
                            <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                              demo
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedDoor?.isDemo === false && (
                  <p className="text-xs text-muted-foreground">
                    {selectedDoor.name} is a live tenant — no demo sign-in is published for it.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@hhsp.edu.in"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <span className="cursor-not-allowed text-xs text-muted-foreground/60">Forgot password?</span>
                </div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={login.isPending}>
                {login.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            {demo && (
              <div className="mt-8 rounded-xl border bg-muted/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-medium">Demo door</div>
                  <span className="text-[11px] text-muted-foreground">password: Hawkings@2026</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {DEMO_LOGINS.map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => {
                        setSchoolSlug("hawkings-prithvipur");
                        setEmail(d.email);
                        setPassword("Hawkings@2026");
                        setError(null);
                      }}
                      className="group rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      <div className="text-[13px] font-medium group-hover:text-primary">{d.label}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{d.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <footer className="mt-auto border-t px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Scholario — built for Indian schools. Session 2026-27.</span>
          <span className="tnum">{doors.length} tenants · demo data resets are safe</span>
        </div>
      </footer>
    </div>
  );
}
