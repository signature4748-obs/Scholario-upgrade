'use client'

/**
 * static-doc-preview — renders a REAL institutional document for the
 * Downloads library's static catalogue (forms, templates, reports).
 *
 * The preview is an A4-proportioned sheet: school letterhead (from School
 * Settings → General), the document title, ruled fill-in fields, data
 * tables, declaration and signature blocks — the actual document, never a
 * bare logo placeholder.
 *
 * `buildStaticDocHTML` produces the same document as standalone HTML for
 * Download (blob file) and Print (new window).
 */

import { GraduationCap } from 'lucide-react'
import { useSchoolProfile } from '@/lib/school-profile'
import type { SchoolProfile } from '@/lib/school-profile'
import type { StaticDocContent } from '@/lib/store/downloads-content'

// ─── React preview (drawer / dialog) ───────────────────────────────────

export function StaticDocPreview({ content }: { content: StaticDocContent }) {
  const school = useSchoolProfile()
  return (
    <div className="print-area w-full bg-slate-100 dark:bg-slate-800/70 p-2 sm:p-3">
      <div className="bg-white text-slate-900 shadow-md shadow-slate-900/10 mx-auto w-full max-w-[560px] p-4 sm:p-6">
        <StaticDocSheet content={content} school={school} />
      </div>
    </div>
  )
}

/** The letterhead + body sheet (shared visual for the preview). */
function StaticDocSheet({ content, school }: { content: StaticDocContent; school: SchoolProfile }) {
  return (
    <div className="font-serif">
      {/* Letterhead */}
      <div className="text-center border-b-2 border-slate-800 pb-3">
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-white shrink-0">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-slate-900">{school.name}</p>
            <p className="text-[8px] text-slate-600 leading-tight">{school.affiliation}</p>
          </div>
        </div>
        <p className="text-[7px] text-slate-500 mt-1 leading-tight">
          {school.address} · {school.phone} · {school.email}
        </p>
      </div>

      {/* Title */}
      <div className="text-center mt-4">
        <h2 className="text-[13px] sm:text-sm font-bold tracking-[0.18em] text-slate-900">
          {content.docTitle}
        </h2>
        {content.subtitle && (
          <p className="text-[9px] text-slate-600 mt-1">{content.subtitle}</p>
        )}
        <div className="h-0.5 w-20 mx-auto mt-2 bg-slate-700" />
      </div>

      {content.instructions && (
        <p className="text-[9px] text-slate-500 italic text-center mt-3 leading-snug">
          {content.instructions}
        </p>
      )}

      {/* Sections with ruled fields */}
      {content.sections.map((sec, i) => (
        <div key={i} className="mt-4">
          {sec.heading && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-800 border-b border-slate-300 pb-1 mb-2">
              {sec.heading}
            </p>
          )}
          <div className="space-y-1.5">
            {sec.fields.map((f, j) => (
              <div key={j} className="flex items-baseline gap-2">
                <span className="text-[9px] text-slate-700 shrink-0 max-w-[55%]">{f}</span>
                <span className="flex-1 border-b border-dotted border-slate-400 h-3" />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Data table */}
      {content.table && (
        <table className="w-full mt-4 text-[9px] border-collapse">
          <thead>
            <tr className="bg-slate-100">
              {content.table.columns.map((c, i) => (
                <th key={i} className="border border-slate-300 px-1.5 py-1.5 text-left font-bold text-slate-800">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.table.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/60' : ''}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-slate-300 px-1.5 py-1 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Declaration */}
      {content.declaration && (
        <p className="text-[9px] text-slate-700 leading-relaxed mt-4 border-t border-slate-200 pt-3">
          <span className="font-bold">Declaration: </span>{content.declaration}
        </p>
      )}

      {/* Signatures */}
      {content.signatures && content.signatures.length > 0 && (
        <div className="grid gap-4 mt-8" style={{ gridTemplateColumns: `repeat(${Math.min(content.signatures.length, 3)}, 1fr)` }}>
          {content.signatures.map((sig, i) => (
            <div key={i} className="text-center">
              <div className="border-t border-slate-600 pt-1">
                <p className="text-[8px] text-slate-700">{sig}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {content.notes && (
        <p className="text-[7px] text-slate-400 text-center mt-4 leading-snug">{content.notes}</p>
      )}
    </div>
  )
}

// ─── Standalone HTML (Download file / Print window) ────────────────────

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Build the same document as standalone printable HTML. */
export function buildStaticDocHTML(content: StaticDocContent, profile: SchoolProfile): string {
  const sections = (content.sections ?? [])
    .map((sec) => {
      const heading = sec.heading ? `<p class="sec-h">${esc(sec.heading)}</p>` : ''
      const fields = sec.fields
        .map((f) => `<div class="field"><span>${esc(f)}</span><i></i></div>`)
        .join('')
      return `${heading}${fields}`
    })
    .join('')

  const table = content.table
    ? `<table class="data">
        <thead><tr>${content.table.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${content.table.rows
          .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table>`
    : ''

  const signatures = content.signatures?.length
    ? `<div class="sign">${content.signatures.map((s) => `<div><span class="line"></span>${esc(s)}</div>`).join('')}</div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(content.docTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; margin: 40px auto; max-width: 700px; color: #1e293b; }
  .letterhead { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 12px; }
  .school { font-size: 21px; font-weight: bold; color: #0f172a; }
  .aff { font-size: 10px; color: #475569; margin-top: 3px; }
  .contact { font-size: 9px; color: #64748b; margin-top: 2px; }
  h1 { text-align: center; font-size: 14px; letter-spacing: 0.22em; margin: 20px 0 4px; color: #0f172a; }
  .sub { text-align: center; font-size: 10px; color: #475569; margin-bottom: 4px; }
  .rule { width: 90px; height: 2px; background: #334155; margin: 8px auto 0; }
  .instr { text-align: center; font-size: 9px; color: #64748b; font-style: italic; margin: 12px 0 0; }
  .sec-h { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 16px 0 6px; }
  .field { display: flex; align-items: baseline; gap: 10px; margin: 7px 0; font-size: 10px; color: #334155; }
  .field span { max-width: 55%; }
  .field i { flex: 1; border-bottom: 1px dotted #94a3b8; height: 12px; }
  table.data { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 10px; }
  table.data th, table.data td { border: 1px solid #94a3b8; padding: 6px 8px; }
  table.data thead th { background: #f1f5f9; color: #0f172a; text-align: left; }
  table.data tbody tr:nth-child(even) { background: #f8fafc; }
  .decl { font-size: 10px; color: #334155; line-height: 1.6; border-top: 1px solid #e2e8f0; margin-top: 16px; padding-top: 10px; }
  .sign { display: flex; justify-content: space-between; margin-top: 54px; font-size: 10px; color: #334155; }
  .sign div { text-align: center; flex: 1; margin: 0 8px; }
  .sign .line { display: block; border-top: 1px solid #475569; margin-bottom: 5px; padding-top: 20px; }
  .notes { text-align: center; font-size: 8px; color: #94a3b8; margin-top: 22px; }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="school">${esc(profile.name)}</div>
    <div class="aff">${esc(profile.affiliation)}</div>
    <div class="contact">${esc(profile.address)} · ${esc(profile.phone)} · ${esc(profile.email)}</div>
  </div>
  <h1>${esc(content.docTitle)}</h1>
  ${content.subtitle ? `<p class="sub">${esc(content.subtitle)}</p>` : ''}
  <div class="rule"></div>
  ${content.instructions ? `<p class="instr">${esc(content.instructions)}</p>` : ''}
  ${sections}
  ${table}
  ${content.declaration ? `<p class="decl"><strong>Declaration: </strong>${esc(content.declaration)}</p>` : ''}
  ${signatures}
  ${content.notes ? `<p class="notes">${esc(content.notes)}</p>` : ''}
</body>
</html>`
}
