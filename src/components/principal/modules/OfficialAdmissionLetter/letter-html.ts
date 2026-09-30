import { formatDate, formatINR } from '@/lib/format'
import type { SchoolProfile } from '@/lib/school-profile'
import type { AdmissionLetterData } from './types'

/**
 * letter-html — standalone branded HTML builder for the Official Admission
 * Letter "Download PDF" action (QA-FIX-A).
 *
 * Mirrors the exact text/sections the React preview renders (SchoolHeader,
 * StudentProfileGrid, FeeBreakdownTable, DigitalVerification,
 * StatutoryDeclaration, Signatures) so the downloaded file matches what the
 * Principal sees on screen. Letterhead comes from useSchoolProfile().
 */

function esc(v: unknown): string {
  return String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const feeRow = (label: string, amount: number, cls = '') =>
  `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(formatINR(amount))}</td></tr>`

export function buildAdmissionLetterHTML(data: AdmissionLetterData, profile: SchoolProfile): string {
  const fullName = `${data.student.firstName} ${data.student.lastName}`
  const fees = data.fees
  const subtotal = fees.subtotal ?? fees.totalAnnualFee ?? 0
  const discountAmount = fees.discountAmount ?? fees.discountApplied ?? 0

  const profileRow = (label: string, value: string | number) =>
    `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`

  const profileRows = [
    profileRow('Student Name', fullName),
    profileRow('Admission No', data.admissionNo),
    profileRow('Admitted Class &amp; Section', `${data.academic.className} — Section ${data.academic.section}`),
    // Session comes from the letter data; an unknown session prints an
    // honest em-dash placeholder, never a fabricated year.
    profileRow('Academic Session', data.academicSession || '—'),
    profileRow('Date of Admission', formatDate(data.admissionDate)),
    profileRow('Date of Birth', formatDate(data.student.dob)),
    profileRow('Assigned Roll Number', data.academic.rollNo || '—'),
    ...(data.studentId ? [profileRow('Student ID', data.studentId)] : []),
    ...(data.regNo ? [profileRow('Registration No', data.regNo)] : []),
    // Official Documents policy: parent contact numbers are sensitive and
    // print only while showSensitiveDetails is ON.
    profileRow(
      'Father / Guardian',
      data.showSensitiveDetails && data.parents.fatherPhone
        ? `${data.parents.fatherName} · ${data.parents.fatherPhone}`
        : data.parents.fatherName
    ),
  ].join('')

  const feeRows = [
    feeRow('Registration Fee', fees.registrationFee || 0),
    feeRow('Admission Fee (One-Time)', fees.admissionFee),
    feeRow('Annual Tuition Fee', fees.tuitionFee),
    ...((fees.booksTotal || 0) > 0
      ? [feeRow('Selected Textbooks &amp; Course Material Package', fees.booksTotal || 0)]
      : []),
    ...((fees.examFee || 0) > 0
      ? [feeRow('Examination &amp; Assessment Group Charges', fees.examFee || 0)]
      : []),
    ...((fees.otherHeadsTotal || 0) > 0
      ? [feeRow('Development &amp; Other Charges', fees.otherHeadsTotal || 0)]
      : []),
    feeRow('Fee Subtotal', subtotal, 'sub'),
    ...(discountAmount > 0
      ? [feeRow(`Discount / Concession (${fees.discountName || 'Approved Concession'})`, -discountAmount, 'discount')]
      : []),
    feeRow('Final Payable Amount', fees.finalPayable, 'total'),
  ].join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Official Admission Letter — ${esc(fullName)} (${esc(data.admissionNo)})</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 36px auto; max-width: 780px; color: #1e293b; background: #fff; }
  .letterhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 3px solid #0f172a; padding-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .logo { width: 56px; height: 56px; border-radius: 12px; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900; }
  .school { font-size: 21px; font-weight: 800; letter-spacing: 0.02em; color: #0f172a; text-transform: uppercase; }
  .aff { font-size: 11px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 3px; }
  .contact { font-size: 10.5px; color: #475569; margin-top: 5px; max-width: 420px; }
  .refbox { text-align: right; }
  .badge { display: inline-block; background: #0f172a; color: #fff; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; padding: 5px 10px; border-radius: 4px; text-transform: uppercase; }
  .ref { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; color: #334155; margin-top: 6px; }
  .ref small { display: block; font-weight: 500; color: #64748b; font-size: 10px; margin-top: 2px; }
  h2 { text-align: center; font-size: 13px; letter-spacing: 0.2em; color: #334155; margin: 22px 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  .profile { margin: 14px 0 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
  .profile th, .profile td { font-size: 11.5px; padding: 6px 10px; border-bottom: 1px solid #eef2f7; text-align: left; }
  .profile tr:last-child th, .profile tr:last-child td { border-bottom: 0; }
  .profile th { color: #64748b; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.06em; width: 32%; }
  .fees { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .fees thead th { background: #f1f5f9; color: #334155; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 10px; text-align: left; }
  .fees td, .fees tfoot td { font-size: 11.5px; padding: 7px 10px; border-top: 1px solid #eef2f7; }
  .fees .num { text-align: right; font-family: ui-monospace, monospace; white-space: nowrap; }
  .fees .sub td { background: #f8fafc; font-weight: 700; }
  .fees .discount td { background: #ecfdf5; color: #065f46; font-weight: 700; }
  .fees .total td { background: #0f172a; color: #fff; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
  .fees .total .num { color: #34d399; }
  .status { font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 4px; }
  .verify { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 20px 0; padding: 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; font-size: 11px; }
  .verify .k { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 700; margin-bottom: 3px; }
  .verify .v { font-family: ui-monospace, monospace; font-weight: 700; color: #1e293b; }
  .verified { display: inline-block; margin-top: 4px; color: #047857; background: #d1fae5; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .decl { font-size: 10.5px; color: #64748b; font-style: italic; text-align: center; line-height: 1.6; margin: 22px 0 30px; }
  .sign { display: flex; justify-content: space-between; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 26px; }
  .sign .name { font-family: Georgia, serif; font-style: italic; font-weight: 700; font-size: 13px; color: #1e293b; border-bottom: 1px solid #94a3b8; padding: 0 18px 6px; display: inline-block; }
  .sign .role { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #475569; margin-top: 6px; letter-spacing: 0.06em; }
  .foot { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 28px; }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="brand">
      <div class="logo">${esc(profile.shortName.charAt(0))}</div>
      <div>
        <div class="school">${esc(profile.name)}</div>
        <div class="aff">${esc(profile.affiliation)}</div>
        <div class="contact">${esc(profile.address)} · Tel: ${esc(profile.phone)} · Email: ${esc(profile.email)}</div>
      </div>
    </div>
    <div class="refbox">
      <span class="badge">Official Admission Letter</span>
      <p class="ref">Ref: ${esc(data.refNo ?? data.admissionNo)}
        <small>Date: ${esc(formatDate(data.admissionDate))}</small>
        <small>Session: ${esc(data.academicSession)}</small>
      </p>
    </div>
  </div>

  <h2>Student Profile Overview</h2>
  <table class="profile">
    <tbody>${profileRows}</tbody>
  </table>

  <h2>Fee Summary</h2>
  <table class="fees">
    <thead><tr><th>Fee Head / Component</th><th class="num">Amount (INR)</th></tr></thead>
    <tbody>${feeRows}</tbody>
  </table>

  <div class="verify">
    <div>
      <div class="k">Document Identification</div>
      <div class="v">DOC-ADM-${esc(data.admissionNo)}</div>
    </div>
    <div>
      <div class="k">Admission No</div>
      <div class="v">${esc(data.admissionNo)} · Session ${esc(data.academicSession)}</div>
    </div>
  </div>

  <p class="decl">&quot;I hereby confirm that the above student has been formally admitted to ${esc(profile.name)} for the Academic Session ${esc(data.academicSession)}. All documents submitted have been verified against original CBSE &amp; State Board specifications.&quot;</p>

  <div class="sign">
    <div>
      <span class="name">${esc(data.parents.fatherName)}</span>
      <div class="role">Parent / Guardian Signature</div>
    </div>
    <div>
      <span class="name">${esc(profile.principal)}</span>
      <div class="role">Principal Signature</div>
    </div>
  </div>

  <p class="foot">Computer-generated official document · ${esc(profile.name)} · ${esc(profile.website)}</p>
</body>
</html>`
}
