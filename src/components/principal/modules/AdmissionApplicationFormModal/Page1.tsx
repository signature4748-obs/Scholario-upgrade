import { useSchoolProfile } from '@/lib/school-profile'

/** Standard Indian admission category checkboxes (blank form furniture,
 * not school data — the applicant ticks one). */
const ADMISSION_CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS']

/** Page 1 of the A4 application form — header, banner, and Sections A–D.
 * Letterhead identity follows the school-profile cascade (server →
 * settings → neutral); unconfigured fields print honestly. */
export function ApplicationFormPage1({ academicSession }: { academicSession: string }) {
  const school = useSchoolProfile()
  return (
    <div className="space-y-6">
      {/* Header / School Info */}
      <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-2xl shrink-0">
            {school.shortName.charAt(0)}
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold uppercase tracking-tight text-slate-900">
              {school.name}
            </h1>
            <p className="text-[11px] font-semibold text-slate-700">{school.affiliation || '—'}</p>
            {school.address && <p className="text-[10px] text-slate-600 mt-0.5">{school.address}</p>}
            <p className="text-[10px] text-slate-600">
              {[
                school.phone ? `Phone: ${school.phone}` : null,
                school.email,
                school.website,
              ].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        </div>

        {/* Passport Photo Box */}
        <div className="h-28 w-24 border-2 border-dashed border-slate-400 bg-slate-50 flex flex-col items-center justify-center p-1 text-center text-[9px] font-semibold text-slate-500 shrink-0">
          <span>AFFIX RECENT</span>
          <span>PASSPORT SIZE</span>
          <span>PHOTOGRAPH</span>
          <span className="text-[8px] text-slate-400 mt-1">(Self-Attested)</span>
        </div>
      </div>

      {/* Form Title Banner */}
      <div className="bg-slate-900 text-white text-center py-2 px-4 rounded font-bold tracking-wider uppercase text-xs flex items-center justify-between">
        <span>ACADEMIC SESSION: {academicSession}</span>
        <span>STUDENT ADMISSION APPLICATION FORM</span>
        <span>FORM NO: ADM-{academicSession !== '—' ? academicSession.slice(0, 4) : '____'}/_______</span>
      </div>

      {/* SECTION A: CANDIDATE PERSONAL INFORMATION */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION A: CANDIDATE PERSONAL DETAILS
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">1. Full Name (Block Letters):</span>
            <div className="flex-1 border-b border-slate-400 h-6 font-mono font-medium text-slate-800"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">2. Date of Birth:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[90px]">3. Gender:</span>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 border border-slate-600 rounded-sm"></span> Male</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 border border-slate-600 rounded-sm"></span> Female</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 border border-slate-600 rounded-sm"></span> Other</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">4. Blood Group:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[90px]">5. Category:</span>
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              {ADMISSION_CATEGORIES.map((cat) => (
                <span key={cat} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 border border-slate-600 rounded-sm"></span> {cat}
                </span>
              ))}
            </div>
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">6. Aadhaar Number:</span>
            <div className="flex-1 border-b border-slate-400 h-6 font-mono tracking-widest"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">7. Religion:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[90px]">8. Nationality:</span>
            <div className="flex-1 border-b border-slate-400 h-6">Indian</div>
          </div>
        </div>
      </div>

      {/* SECTION B: PARENT & EMERGENCY CONTACT DETAILS */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION B: PARENT & GUARDIAN DETAILS
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">1. Father's Name:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Father's Occupation:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Father's Mobile No:</span>
            <div className="flex-1 border-b border-slate-400 h-6 font-mono"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Father's Email:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <span className="font-bold text-[11px] min-w-[130px]">2. Mother's Name:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <span className="font-bold text-[11px] min-w-[130px]">Mother's Occupation:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Mother's Mobile No:</span>
            <div className="flex-1 border-b border-slate-400 h-6 font-mono"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Mother's Email:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          {/* Emergency Contact */}
          <div className="col-span-2 pt-2 border-t border-slate-200 grid grid-cols-3 gap-2">
            <div className="flex items-center gap-1">
              <span className="font-bold text-[10px]">3. Emergency Contact Name:</span>
              <div className="flex-1 border-b border-slate-400 h-5"></div>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-[10px]">Relationship:</span>
              <div className="flex-1 border-b border-slate-400 h-5"></div>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-[10px]">Emergency Phone:</span>
              <div className="flex-1 border-b border-slate-400 h-5 font-mono"></div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION C: RESIDENTIAL ADDRESS */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION C: RESIDENTIAL ADDRESS
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Current Address:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-1">
              <span className="font-bold text-[10px]">District:</span>
              <div className="flex-1 border-b border-slate-400 h-5"></div>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-[10px]">State:</span>
              <div className="flex-1 border-b border-slate-400 h-5"></div>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-[10px]">Pincode:</span>
              <div className="flex-1 border-b border-slate-400 h-5 font-mono"></div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="font-bold text-[11px] min-w-[130px]">Permanent Address:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>
        </div>
      </div>

      {/* SECTION D: PREVIOUS ACADEMIC RECORD */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION D: PREVIOUS ACADEMIC RECORD
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Previous School Name:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Last Class Passed:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Academic Year:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="col-span-2 flex items-center justify-between pt-1">
            <span className="font-bold text-[11px]">Transfer Certificate (TC) Enclosed?</span>
            <div className="flex items-center gap-6 font-semibold text-[11px]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 border-2 border-slate-800 rounded text-center leading-3 font-bold">✓</span> YES (Enclosed)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 border-2 border-slate-800 rounded text-center leading-3 font-bold text-slate-400">✗</span> NO (To be submitted later)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Page 1 Bottom Footer */}
      <div className="pt-4 border-t border-slate-300 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span>{school.name} · Admission Application Form</span>
        <span>Page 1 of 2</span>
      </div>
    </div>
  )
}
