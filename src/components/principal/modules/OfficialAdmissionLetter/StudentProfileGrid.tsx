import { User } from 'lucide-react'
import { formatDate } from '@/lib/format'
import type { AdmissionLetterData } from './types'

/** Student profile overview grid — actual photo, admission no, demographics, parents. */
export function StudentProfileGrid({ data, fullName }: { data: AdmissionLetterData; fullName: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
      {/* Photo & Badge Box */}
      <div className="flex flex-col items-center justify-center p-2 border-r-0 md:border-r border-slate-200 pr-0 md:pr-4">
        <div className="h-28 w-24 rounded-lg bg-slate-100 border-2 border-slate-300 flex flex-col items-center justify-center text-slate-400 font-bold overflow-hidden shadow-inner relative">
          {data.student.photoUrl ? (
            <img src={data.student.photoUrl} alt={`${fullName} photo`} className="h-full w-full object-cover" />
          ) : data.student.photoUploaded ? (
            <div className="w-full h-full bg-slate-800 text-white flex items-center justify-center font-black text-2xl font-display">
              {data.student.firstName[0]}{data.student.lastName[0]}
            </div>
          ) : (
            <User className="h-10 w-10 text-slate-400" />
          )}
        </div>
        <div className="mt-2 text-center">
          <span className="text-[10px] font-mono font-bold text-slate-500 uppercase block">Admission No</span>
          <span className="text-xs font-mono font-extrabold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-300 shadow-xs">
            {data.admissionNo}
          </span>
        </div>
      </div>

      {/* Student Info */}
      <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Student Name</span>
          <span className="font-bold text-slate-900 text-sm">{fullName}</span>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Admitted Class & Section</span>
          <span className="font-extrabold text-emerald-800 text-sm">{data.academic.className} — Section {data.academic.section}</span>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Academic Session</span>
          <span className="font-mono font-bold text-slate-900">{data.academicSession || '—'}</span>
        </div>

        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Date of Admission</span>
          <span className="font-semibold text-slate-800">{formatDate(data.admissionDate)}</span>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Date of Birth</span>
          <span className="font-semibold text-slate-800">{formatDate(data.student.dob)}</span>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Assigned Roll Number</span>
          <span className="font-mono font-bold text-slate-900">{data.academic.rollNo || '—'}</span>
        </div>

        {data.studentId && (
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Student ID</span>
            <span className="font-mono font-bold text-slate-900">{data.studentId}</span>
          </div>
        )}
        {data.regNo && (
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Registration No</span>
            <span className="font-mono font-bold text-slate-900">{data.regNo}</span>
          </div>
        )}

        <div className="col-span-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Father / Guardian</span>
          <span className="font-semibold text-slate-800">
            {data.parents.fatherName}
            {data.showSensitiveDetails && data.parents.fatherPhone ? ` · ${data.parents.fatherPhone}` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
