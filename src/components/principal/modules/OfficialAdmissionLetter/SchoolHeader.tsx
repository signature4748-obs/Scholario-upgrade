import { useSchoolProfile } from '@/lib/school-profile'
import { formatDate } from '@/lib/format'
import type { AdmissionLetterData } from './types'

/** Diagonal subtle watermark of the school short name. */
export function Watermark() {
  const profile = useSchoolProfile()
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.03] select-none rotate-[-30deg]">
      <span className="text-7xl font-black font-display uppercase tracking-widest text-slate-900">
        {profile.shortName}
      </span>
    </div>
  )
}

/** School header — logo, name, affiliation, contact, ref/date/session sidebar.
 * Letterhead identity follows the sanctioned school-profile cascade
 * (server identity → settings → neutral) — never a hardcoded demo school. */
export function SchoolHeader({ data }: { data: AdmissionLetterData }) {
  const profile = useSchoolProfile()
  return (
    <div className="border-b-2 border-slate-900 pb-6 mb-6">
      <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-2xl font-display shadow-md">
            {profile.shortName.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold font-display tracking-tight text-slate-900 uppercase">
              {profile.name}
            </h1>
            <p className="text-xs font-bold text-emerald-800 tracking-wide uppercase mt-0.5">
              {profile.affiliation || '—'}
            </p>
            <p className="text-[11px] text-slate-600 mt-1 max-w-md">
              {[profile.address, profile.phone ? `Tel: ${profile.phone}` : null, profile.email ? `Email: ${profile.email}` : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
          </div>
        </div>

        <div className="text-right sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200 w-full sm:w-auto">
          <span className="inline-block px-3 py-1 bg-slate-900 text-white font-mono text-[11px] font-bold tracking-wider rounded uppercase">
            OFFICIAL ADMISSION LETTER
          </span>
          <p className="text-xs font-mono font-bold text-slate-700 mt-1">Ref: {data.refNo || data.admissionNo}</p>
          <p className="text-[11px] text-slate-500 font-medium">Date: {formatDate(data.admissionDate)}</p>
          <p className="text-[11px] text-slate-500 font-medium">Session: {data.academicSession}</p>
        </div>
      </div>
    </div>
  )
}
