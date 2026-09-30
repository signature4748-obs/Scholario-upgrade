import { useSchoolProfile } from '@/lib/school-profile'

/** Page 2 of the A4 application form — mini header and Sections E–H. */
export function ApplicationFormPage2({ academicSession }: { academicSession: string }) {
  const school = useSchoolProfile()
  return (
    <div className="space-y-6">
      {/* Header Mini Banner */}
      <div className="border-b border-slate-900 pb-2 flex items-center justify-between">
        <div>
          <span className="font-extrabold text-sm uppercase text-slate-900">{school.name}</span>
          <span className="text-[10px] text-slate-600 block">Admission Application Form · AY {academicSession}</span>
        </div>
        <span className="font-bold text-xs bg-slate-100 px-2.5 py-1 rounded border border-slate-300">
          PAGE 2 OF 2
        </span>
      </div>

      {/* SECTION E: CLASS SEEKING & FACILITIES REQUIRED */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION E: CLASS SEEKING & FACILITIES SELECTION
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[11px] min-w-[130px]">Class Applying For:</span>
              <div className="flex-1 border-b border-slate-400 h-6"></div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-bold text-[11px] min-w-[130px]">Preferred Section:</span>
              <div className="flex-1 border-b border-slate-400 h-6"></div>
            </div>
          </div>

          {/* Transport Checkmark Box */}
          <div className="p-3 border border-slate-300 rounded bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[11px] text-slate-900">1. School Transport Bus Facility Required?</span>
              <div className="flex items-center gap-6 font-bold text-xs">
                <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 border-2 border-slate-800 rounded text-center leading-3 font-bold">✓</span> YES</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 border-2 border-slate-800 rounded text-center leading-3 font-bold">✗</span> NO</span>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-slate-600 font-medium">Pickup / Drop Route or Landmark:</span>
              <div className="flex-1 border-b border-slate-400 h-5"></div>
            </div>
          </div>

          {/* Hostel Checkmark Box */}
          <div className="p-3 border border-slate-300 rounded bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[11px] text-slate-900">2. School Hostel Boarding Facility Required?</span>
              <div className="flex items-center gap-6 font-bold text-xs">
                <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 border-2 border-slate-800 rounded text-center leading-3 font-bold">✓</span> YES</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 border-2 border-slate-800 rounded text-center leading-3 font-bold">✗</span> NO</span>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-slate-600 font-medium">Special Lodging or Dietary Requirements (if any):</span>
              <div className="flex-1 border-b border-slate-400 h-5"></div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION F: MEDICAL DECLARATION */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION F: MEDICAL & HEALTH DECLARATION
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Known Allergies:</span>
            <div className="flex-1 border-b border-slate-400 h-6">None</div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Medical Conditions:</span>
            <div className="flex-1 border-b border-slate-400 h-6">None</div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Family Doctor Name:</span>
            <div className="flex-1 border-b border-slate-400 h-6"></div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-[11px] min-w-[130px]">Doctor Phone No:</span>
            <div className="flex-1 border-b border-slate-400 h-6 font-mono"></div>
          </div>
        </div>
      </div>

      {/* SECTION G: DOCUMENT ATTACHMENT CHECKLIST */}
      <div className="space-y-3">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION G: MANDATORY DOCUMENTS ATTACHMENT CHECKLIST
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-medium">
          <div className="flex items-center gap-1.5 p-1.5 border border-slate-200 rounded">
            <span className="h-3.5 w-3.5 border border-slate-600 rounded-sm inline-block"></span>
            <span>Birth Certificate (Attested Copy)</span>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 border border-slate-200 rounded">
            <span className="h-3.5 w-3.5 border border-slate-600 rounded-sm inline-block"></span>
            <span>Transfer Certificate (Original TC)</span>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 border border-slate-200 rounded">
            <span className="h-3.5 w-3.5 border border-slate-600 rounded-sm inline-block"></span>
            <span>Student Aadhaar Card Copy</span>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 border border-slate-200 rounded">
            <span className="h-3.5 w-3.5 border border-slate-600 rounded-sm inline-block"></span>
            <span>Passport Size Photos (3 Copies)</span>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 border border-slate-200 rounded">
            <span className="h-3.5 w-3.5 border border-slate-600 rounded-sm inline-block"></span>
            <span>Previous Class Marksheet / Grade Card</span>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 border border-slate-200 rounded">
            <span className="h-3.5 w-3.5 border border-slate-600 rounded-sm inline-block"></span>
            <span>Parents Identity / Address Proof</span>
          </div>
        </div>
      </div>

      {/* SECTION H: PARENT UNDERTAKING & OFFICIAL SIGNATURES */}
      <div className="space-y-4 pt-2">
        <div className="bg-slate-100 border-l-4 border-slate-900 px-3 py-1 font-bold text-[11px] uppercase tracking-wide text-slate-800">
          SECTION H: PARENT DECLARATION & OFFICIAL APPROVAL
        </div>

        <p className="text-[10px] text-slate-700 leading-normal text-justify">
          I hereby declare that all information furnished in this admission application form is true, complete, and correct to the best of my knowledge and belief. I agree to abide by the rules, code of conduct, discipline guidelines, and fee regulations set forth by <strong>{school.name}</strong>.
        </p>

        <div className="grid grid-cols-3 gap-6 pt-12">
          <div className="text-center border-t border-slate-800 pt-1">
            <span className="font-bold text-[10px] block">Signature of Parent / Guardian</span>
            <span className="text-[9px] text-slate-500">Date: ____ / ____ / ________</span>
          </div>

          <div className="text-center border-t border-slate-800 pt-1">
            <span className="font-bold text-[10px] block">Admission Officer / Verification</span>
            <span className="text-[9px] text-slate-500">Docs Verified & Clearance Granted</span>
          </div>

          <div className="text-center border-t border-slate-800 pt-1 relative">
            {/* School Stamp Box */}
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 h-12 w-24 border border-dashed border-slate-400 rounded flex items-center justify-center text-[8px] text-slate-400 uppercase">
              [ School Seal Stamp ]
            </div>
            <span className="font-bold text-[10px] block mt-2">Principal Signature & Stamp</span>
            <span className="text-[9px] text-slate-500">{school.principal || 'Principal'}</span>
          </div>
        </div>
      </div>

      {/* Page 2 Bottom Footer */}
      <div className="pt-6 border-t border-slate-300 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span>{school.name} · Official Admission Form</span>
        <span>Page 2 of 2</span>
      </div>
    </div>
  )
}
