'use client'

import { useRef } from 'react'
import { Printer, KeyRound, GraduationCap, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { printIsolated } from '@/lib/print-isolate'
import { useSchoolProfile } from '@/lib/school-profile'
import type { IssuanceArtifacts } from './letter-data'

interface CredentialsTabProps {
  artifacts: IssuanceArtifacts
  guardianEmail?: string | null
}

/**
 * Student Portal Onboarding sheet — FINAL-GATE honesty redesign.
 *
 * This tab used to print a FABRICATED portal login (loginId +
 * tempPassword + "portal.scholario.app") for credentials that were never
 * created. The sheet now documents the REAL provisioning path — since
 * Phase 7-H the issuance workspace itself enrolls the student on the
 * school server (Complete Admission & Enroll → POST /api/students) and
 * surfaces the platform-created one-time password exactly once. It
 * prints cleanly on its own.
 */
export function CredentialsTab({ artifacts, guardianEmail }: CredentialsTabProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const school = useSchoolProfile()

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div
        ref={sheetRef}
        className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5 print:shadow-none print:rounded-none"
      >
        {/* Letterhead */}
        <div className="border-b-2 border-slate-200 pb-3">
          <h2 className="font-bold text-base uppercase tracking-wide text-slate-900">
            Student Portal — Onboarding Guide
          </h2>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {school.name} · Admission {artifacts.admissionNo}
          </p>
        </div>

        {/* Admission references */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            { label: 'Admission No.', value: artifacts.admissionNo },
            { label: 'Student ID', value: artifacts.studentId },
            { label: 'Roll No.', value: artifacts.rollNo },
            { label: 'Registration No.', value: artifacts.regNo },
          ].map(({ label, value }) => (
            <div key={label} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{label}</span>
              <span className="font-mono font-bold text-slate-900 break-all">{value}</span>
            </div>
          ))}
        </div>

        {/* The real provisioning path */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            How the portal account is created
          </h3>
          <ol className="space-y-2 text-[11.5px] text-slate-700 leading-relaxed list-decimal list-inside">
            <li className="flex items-start gap-2">
              <span className="pt-0.5">
                The office completes the admission here —{' '}
                <strong className="font-semibold">Complete Admission &amp; Enroll</strong> creates the
                student&apos;s account on the school server (the same enrollment is also available from{' '}
                <strong className="font-semibold">Students &amp; Classes → Add Student</strong>),
                using the guardian&rsquo;s email below as the login ID.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="pt-0.5">
                The platform creates the account and{' '}
                <strong className="font-semibold">shows a one-time temporary password</strong> at that
                moment — copy it and hand it to the parents securely.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <GraduationCap className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="pt-0.5 flex-1">
                The student signs in at this school&rsquo;s login page and changes the password at first
                sign-in.
              </span>
            </li>
          </ol>
        </div>

        {/* Guardian email on file */}
        <div className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50">
          <Mail className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-xs">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">
              Login ID to use (guardian email on file)
            </span>
            <span className="font-mono font-bold text-slate-900 break-all">
              {guardianEmail?.trim() || '— not provided on the admission form —'}
            </span>
          </div>
        </div>

        <p className="text-[9px] text-slate-400 text-center font-mono">
          Onboarding sheet for Admission {artifacts.admissionNo} · Generated{' '}
          {new Date().toLocaleDateString('en-IN')}
        </p>
      </div>

      <div className="flex items-center gap-2 print:hidden">
        <Button
          size="sm"
          variant="outline"
          onClick={() => printIsolated(sheetRef.current)}
          className="text-xs gap-1.5"
        >
          <Printer className="h-3.5 w-3.5" />
          Print Sheet
        </Button>
      </div>
    </div>
  )
}
