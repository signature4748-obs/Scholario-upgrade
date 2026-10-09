"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ModuleCtx } from "@/lib/types";
import {
  LayoutDashboard, Users, GraduationCap, Layers, CalendarCheck, ClipboardList, Grid3x3,
  Wallet, UserPlus, Banknote, Megaphone, Settings, ClipboardCheck, NotebookPen,
  ReceiptIndianRupee, Trophy, UserRound, type LucideIcon,
} from "lucide-react";

export type ModuleComponent = LazyExoticComponent<ComponentType<{ ctx: ModuleCtx }>>;

export interface ModuleDef {
  id: string;
  title: string;
  icon: LucideIcon;
  roles: Array<"PRINCIPAL" | "TEACHER" | "STUDENT">;
  component: ModuleComponent;
}

export const MODULES: ModuleDef[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    roles: ["PRINCIPAL", "TEACHER", "STUDENT"],
    component: lazy(() => import("@/components/modules/dashboard-module").then((m) => ({ default: m.DashboardModule }))),
  },
  {
    id: "students",
    title: "Students",
    icon: Users,
    roles: ["PRINCIPAL", "TEACHER"],
    component: lazy(() => import("@/components/modules/students-module").then((m) => ({ default: m.StudentsModule }))),
  },
  {
    id: "teachers",
    title: "Teachers",
    icon: GraduationCap,
    roles: ["PRINCIPAL"],
    component: lazy(() => import("@/components/modules/teachers-module").then((m) => ({ default: m.TeachersModule }))),
  },
  {
    id: "classes",
    title: "Classes & Sections",
    icon: Layers,
    roles: ["PRINCIPAL"],
    component: lazy(() => import("@/components/modules/classes-module").then((m) => ({ default: m.ClassesModule }))),
  },
  {
    id: "attendance",
    title: "Attendance",
    icon: CalendarCheck,
    roles: ["PRINCIPAL", "TEACHER", "STUDENT"],
    component: lazy(() => import("@/components/modules/attendance-module").then((m) => ({ default: m.AttendanceModule }))),
  },
  {
    id: "exams",
    title: "Examinations",
    icon: ClipboardList,
    roles: ["PRINCIPAL"],
    component: lazy(() => import("@/components/modules/exams-module").then((m) => ({ default: m.ExamsModule }))),
  },
  {
    id: "marks",
    title: "Marks Entry",
    icon: ClipboardCheck,
    roles: ["TEACHER", "PRINCIPAL"],
    component: lazy(() => import("@/components/modules/marks-module").then((m) => ({ default: m.MarksModule }))),
  },
  {
    id: "timetable",
    title: "Timetable",
    icon: Grid3x3,
    roles: ["PRINCIPAL", "TEACHER", "STUDENT"],
    component: lazy(() => import("@/components/modules/timetable-module").then((m) => ({ default: m.TimetableModule }))),
  },
  {
    id: "fees",
    title: "Fees & Finance",
    icon: Wallet,
    roles: ["PRINCIPAL", "STUDENT"],
    component: lazy(() => import("@/components/modules/fees-module").then((m) => ({ default: m.FeesModule }))),
  },
  {
    id: "fee-collection",
    title: "Fee Collection",
    icon: ReceiptIndianRupee,
    roles: ["TEACHER"],
    component: lazy(() => import("@/components/modules/fee-collection-module").then((m) => ({ default: m.FeeCollectionModule }))),
  },
  {
    id: "admissions",
    title: "Admissions",
    icon: UserPlus,
    roles: ["PRINCIPAL"],
    component: lazy(() => import("@/components/modules/admissions-module").then((m) => ({ default: m.AdmissionsModule }))),
  },
  {
    id: "salary",
    title: "Salary",
    icon: Banknote,
    roles: ["PRINCIPAL", "TEACHER"],
    component: lazy(() => import("@/components/modules/salary-module").then((m) => ({ default: m.SalaryModule }))),
  },
  {
    id: "lesson-planner",
    title: "Lesson Planner",
    icon: NotebookPen,
    roles: ["TEACHER"],
    component: lazy(() => import("@/components/modules/lesson-planner-module").then((m) => ({ default: m.LessonPlannerModule }))),
  },
  {
    id: "notices",
    title: "Notices",
    icon: Megaphone,
    roles: ["PRINCIPAL", "TEACHER", "STUDENT"],
    component: lazy(() => import("@/components/modules/notices-module").then((m) => ({ default: m.NoticesModule }))),
  },
  {
    id: "results",
    title: "My Results",
    icon: Trophy,
    roles: ["STUDENT"],
    component: lazy(() => import("@/components/modules/results-module").then((m) => ({ default: m.ResultsModule }))),
  },
  {
    id: "profile",
    title: "My Profile",
    icon: UserRound,
    roles: ["STUDENT"],
    component: lazy(() => import("@/components/modules/profile-module").then((m) => ({ default: m.ProfileModule }))),
  },
  {
    id: "settings",
    title: "School Settings",
    icon: Settings,
    roles: ["PRINCIPAL"],
    component: lazy(() => import("@/components/modules/settings-module").then((m) => ({ default: m.SettingsModule }))),
  },
];

export const MODULE_GROUPS: { label: string; modules: string[] }[] = [
  { label: "Overview", modules: ["dashboard"] },
  { label: "Academics", modules: ["students", "teachers", "classes", "attendance", "exams", "marks", "timetable", "lesson-planner", "results"] },
  { label: "Finance", modules: ["fees", "fee-collection", "salary"] },
  { label: "School", modules: ["admissions", "notices", "settings", "profile"] },
];
