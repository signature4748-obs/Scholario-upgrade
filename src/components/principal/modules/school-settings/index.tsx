'use client'

// School Settings module — modular composition root.
//
// PHASE 7.5 RE-ARCHITECTURE: the settings centre is now a real
// server-backed configuration hub. Tab strip (IA per the Phase 7.5 audit
// remediation):
//
//   Identity   — PATCH /api/school-settings {identity}
//   Branding   — colors (contrast-checked) + logo/favicon uploads   [NEW]
//   Academics  — session/board from the SERVER school record (read-only)
//   Timetable  — PATCH {settings:{timetable}} (period-ladder config)
//   Attendance — PATCH {settings:{attendance}}                      [NEW]
//   Fees       — local template editor + honest scope banner
//   Uniforms   — editor + PATCH {settings:{uniforms}}
//   Library    — PATCH {settings:{libraryRules}}
//   ID Cards   — editor + PATCH {settings:{idCard}} + real preview
//   Website    — the Website CMS + gallery manager                 [NEW]
//   Modules    — read-only effective module flags                  [NEW]
//   My Account — session/security (unchanged)
//
// The Facilities tab (rooms → real /api/rooms API, Phase 5) stays: it was
// already server-backed and functional.
//
// Store hydration: on principal panel mount the school-settings store
// syncs from GET /api/school-settings (server-sync.ts —
// once-per-session promise, honest error state) so identity/branding and
// every settings slice follow the database, with the local tenant store
// as the pre-sync fallback.

import { useState } from 'react'
import {
  Settings as SettingsIcon, School, Palette, BookOpen, DoorOpen, Clock,
  CalendarCheck, IndianRupee, Shirt, BookMarked, IdCard, Globe, Blocks, ShieldCheck,
} from 'lucide-react'
import { SectionHeading } from '@/components/shared/ui'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'

import { IdentityTab } from './identity-tab'
import { BrandingTab } from './branding-tab'
import { AcademicsTab } from './academics-tab'
import { FacilitiesTab } from './facilities-tab'
import { TimetableTab } from './timetable-tab'
import { AttendanceTab } from './attendance-tab'
import { FeesTab } from './fees-tab'
import { UniformsTab } from './uniforms-tab'
import { LibraryTab } from './library-tab'
import { IdCardTab } from './id-card-tab'
import { WebsiteTab } from './website-tab'
import { ModulesTab } from './modules-tab'
import { SecurityTab } from './security-tab'

export function SchoolSettingsModule() {
  const [tab, setTab] = useState('identity')

  return (
    <div className="space-y-6">
      <SectionHeading
        title="School Settings"
        subtitle="Server-backed school configuration · identity, branding, modules and the public website"
        icon={<SettingsIcon className="h-5 w-5" />}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60 p-1.5 rounded-xl border border-border">
          <TabsTrigger value="identity" className="gap-1.5 text-xs"><School className="h-3.5 w-3.5" /> Identity</TabsTrigger>
          <TabsTrigger value="branding" className="gap-1.5 text-xs"><Palette className="h-3.5 w-3.5" /> Branding</TabsTrigger>
          <TabsTrigger value="academics" className="gap-1.5 text-xs"><BookOpen className="h-3.5 w-3.5" /> Academics</TabsTrigger>
          <TabsTrigger value="timetable" className="gap-1.5 text-xs"><Clock className="h-3.5 w-3.5" /> Timetable</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5 text-xs"><CalendarCheck className="h-3.5 w-3.5" /> Attendance</TabsTrigger>
          <TabsTrigger value="fees" className="gap-1.5 text-xs"><IndianRupee className="h-3.5 w-3.5" /> Fees</TabsTrigger>
          <TabsTrigger value="facilities" className="gap-1.5 text-xs"><DoorOpen className="h-3.5 w-3.5" /> Facilities</TabsTrigger>
          <TabsTrigger value="uniforms" className="gap-1.5 text-xs"><Shirt className="h-3.5 w-3.5" /> Uniforms</TabsTrigger>
          <TabsTrigger value="library" className="gap-1.5 text-xs"><BookMarked className="h-3.5 w-3.5" /> Library</TabsTrigger>
          <TabsTrigger value="idcard" className="gap-1.5 text-xs"><IdCard className="h-3.5 w-3.5" /> ID Cards</TabsTrigger>
          <TabsTrigger value="website" className="gap-1.5 text-xs"><Globe className="h-3.5 w-3.5" /> Website</TabsTrigger>
          <TabsTrigger value="modules" className="gap-1.5 text-xs"><Blocks className="h-3.5 w-3.5" /> Modules</TabsTrigger>
          <TabsTrigger value="account" className="gap-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> My Account</TabsTrigger>
        </TabsList>

        <TabsContent value="identity"><IdentityTab /></TabsContent>
        <TabsContent value="branding"><BrandingTab /></TabsContent>
        <TabsContent value="academics"><AcademicsTab /></TabsContent>
        <TabsContent value="timetable"><TimetableTab /></TabsContent>
        <TabsContent value="attendance"><AttendanceTab /></TabsContent>
        <TabsContent value="fees"><FeesTab /></TabsContent>
        <TabsContent value="facilities"><FacilitiesTab /></TabsContent>
        <TabsContent value="uniforms"><UniformsTab /></TabsContent>
        <TabsContent value="library"><LibraryTab /></TabsContent>
        <TabsContent value="idcard"><IdCardTab /></TabsContent>
        <TabsContent value="website"><WebsiteTab /></TabsContent>
        <TabsContent value="modules"><ModulesTab /></TabsContent>
        <TabsContent value="account"><SecurityTab /></TabsContent>
      </Tabs>
    </div>
  )
}

export default SchoolSettingsModule
