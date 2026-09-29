'use client'

/**
 * TourFormDocument — the OFFICIAL A4 school document behind the built-in
 * "Educational Tour — Parent Consent Form", in TWO selectable layouts:
 *
 *   classic  — "Classic Office": the traditional school-office document.
 *              Strong institutional letterhead with a double-ring emblem,
 *              circular no./date row between heavy rules, ruled fill-in
 *              lines, the boxed declaration — formal throughout.
 *   modern   — "Scholario Modern": clean sections, hairline rules, no
 *              boxes, generous spacing and breathing room toward the
 *              lower half of the page.
 *
 * Both layouts carry IDENTICAL content (AF-TPL contract): school identity,
 * circular/ref row, tour information, student details, parent/guardian
 * details, health/care information, the parental undertaking, signatures
 * and the office-use strip. Blank copies print dotted fill-in rules;
 * filled copies print the immutable submission snapshot.
 *
 * The choice is made when a session is created (app.docTemplate) and flows
 * through the on-screen preview, browser Print and every PDF download.
 *
 * Print mechanics: clone pipeline identical to the fee receipt — clone
 * into #print-root at body level, hide everything else via
 * body.tour-printing, restore on afterprint. @page A4 portrait, margin 0
 * (each document carries its own print-safe margins).
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store/store'
import {
  deriveSubmissionPayment, docTemplateOf,
  type SchoolApplication, type ApplicationSubmission, type SubmissionPaymentInfo,
} from '@/lib/store/applications-store'
import { formatINR, formatDate } from '@/lib/format'

// ─── Print plumbing ─────────────────────────────────────────────────

/** Prints ONLY this document; everything else is hidden while printing. */
export function printTourDocument(): void {
  const node = document.querySelector('.tour-print-doc')
  if (!node) return window.print()
  let root = document.getElementById('print-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'print-root'
    document.body.appendChild(root)
  }
  root.replaceChildren(node.cloneNode(true))
  document.body.classList.add('tour-printing')
  const cleanup = () => {
    document.body.classList.remove('tour-printing')
    root?.replaceChildren()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  setTimeout(cleanup, 30_000)
  window.print()
}

// ─── A4 preview scaling (properly scaled, scrollable) ──────────────────

/**
 * `useFitA4Zoom` — measures the container and returns the zoom factor that
 * fits one 210mm page into its width (clamped 0.3–1). The wrapper applies
 * CSS `zoom`, so the print clone (which lives outside the wrapper) always
 * prints at natural A4 size.
 */
export function useFitA4Zoom<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [zoom, setZoom] = useState(0.55)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setZoom(Math.min(1, Math.max(0.28, (w - 8) / 794)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return [ref, zoom]
}

// ─── The two document skins ──────────────────────────────────────────

interface DocSkin {
  /** Page padding (print-safe margins). */
  pagePadding: string
  /** Section title style. */
  sectionGap: string
  sectionRule: CSSProperties['borderBottom']
  sectionLabelColor: string
  /** Field row style. */
  rowPad: string
  labelSize: string
  labelColor: string
  labelSpacing: string
  labelWeight: number
  valueSize: string
  filledRule: string
  blankRule: string
  /** Declaration block. */
  declBoxed: boolean
  declLeading: number
  declSize: string
  /** Signature area. */
  sigRule: string
  sigHeight: string
  sigGap: string
  /** Office-use strip. */
  officeRule: string
  officeCentered: boolean
}

const CLASSIC: DocSkin = {
  pagePadding: '12mm 13mm 10mm',
  sectionGap: '3.2mm',
  sectionRule: '0.2mm solid #999',
  sectionLabelColor: '#111',
  rowPad: '0.7mm 0',
  labelSize: '8px',
  labelColor: '#333',
  labelSpacing: '0.05em',
  labelWeight: 700,
  valueSize: '10px',
  filledRule: '0.2mm solid #b5b5b5',
  blankRule: '0.35mm dotted #777',
  declBoxed: true,
  declLeading: 1.55,
  declSize: '9px',
  sigRule: '0.35mm dotted #555',
  sigHeight: '10mm',
  sigGap: '6mm',
  officeRule: '0.5mm dashed #555',
  officeCentered: true,
}

const MODERN: DocSkin = {
  pagePadding: '12mm 16mm 11mm',
  sectionGap: '5.3mm',
  sectionRule: 'none',
  sectionLabelColor: '#6a6a6a',
  rowPad: '1.15mm 0',
  labelSize: '7px',
  labelColor: '#6a6a6a',
  labelSpacing: '0.14em',
  labelWeight: 600,
  valueSize: '10px',
  filledRule: '0.18mm solid #c9c9c9',
  blankRule: '0.3mm dotted #9a9a9a',
  declBoxed: false,
  declLeading: 1.66,
  declSize: '9px',
  sigRule: '0.18mm solid #bdbdbd',
  sigHeight: '10mm',
  sigGap: '8mm',
  officeRule: '0.18mm solid #c9c9c9',
  officeCentered: false,
}

// ─── Document primitives (variant-aware) ──────────────────────────────

/** Label + value-on-rule row. Blank copies print the dotted fill-in rule. */
function DocRow({ label, children, wide, k }: { label: string; children?: ReactNode; wide?: boolean; k: DocSkin }) {
  const filled = children !== undefined && children !== null && children !== ''
  return (
    <div
      className={wide ? 'col-span-2' : ''}
      style={{ display: 'flex', alignItems: 'baseline', gap: '2.2mm', padding: k.rowPad, minWidth: 0 } as CSSProperties}
    >
      <span style={{
        fontSize: k.labelSize, fontWeight: k.labelWeight, letterSpacing: k.labelSpacing,
        textTransform: 'uppercase', color: k.labelColor, whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {label}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: k.valueSize, color: '#111', textAlign: 'left',
          borderBottom: filled ? k.filledRule : k.blankRule,
          paddingBottom: '0.35mm', lineHeight: 1.35,
        }}
      >
        {children ?? '\u00A0'}
      </span>
    </div>
  )
}

function PhotoBox({ k }: { k: DocSkin }) {
  return (
    <div
      className="shrink-0 flex flex-col items-center justify-start"
      style={{ width: '22mm', height: '28mm', border: k === MODERN ? '0.25mm dashed #aaa' : '0.3mm dashed #444' }}
    >
      <p style={{ fontSize: '6px', color: '#777', marginTop: '9mm', textAlign: 'center', lineHeight: 1.35 }}>
        Affix recent<br />passport-size<br />photograph
      </p>
    </div>
  )
}

/** Section heading — classic: caps + rule to the margin; modern: bare caps. */
function SectionTitle({ children, k }: { children: ReactNode; k: DocSkin }) {
  return (
    <div className="flex items-baseline" style={{ gap: '2.5mm', marginTop: k.sectionGap, marginBottom: '0.7mm' }}>
      <p style={{
        fontSize: k === MODERN ? '8px' : '9px',
        fontWeight: k === MODERN ? 600 : 700,
        letterSpacing: k === MODERN ? '0.22em' : '0.18em',
        color: k.sectionLabelColor,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {children}
      </p>
      {k.sectionRule !== 'none' && (
        <span aria-hidden style={{ flex: 1, borderBottom: k.sectionRule, transform: 'translateY(-0.4mm)' }} />
      )}
    </div>
  )
}

/** Two-column grid of DocRows with generous gutters, no borders. */
function RowGrid({ children, k }: { children: ReactNode; k: DocSkin }) {
  return <div className="grid grid-cols-2" style={{ columnGap: k === MODERN ? '9mm' : '7mm' }}>{children}</div>
}

// ─── Shared content model ─────────────────────────────────────────────

interface DocModel {
  schoolName: string
  logoText: string
  affiliation: string
  address: string
  contact: string
  destination: string
  datesLabel: string
  feeLabel: string
  paymentStatus: string | null
  emergency: string
  meal: string
  motion: boolean | undefined
  medical: string
  tourNote: string
}

function useDocModel(app: SchoolApplication, sub?: ApplicationSubmission, payment?: SubmissionPaymentInfo): DocModel {
  const g = useSchoolSettingsStore((s) => s.general)
  const schoolName = g.schoolName?.trim() || 'School'
  const logoText = (g.logoText || schoolName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')).toUpperCase()

  const pay = payment ?? (sub ? deriveSubmissionPayment(app, sub) : undefined)
  const datesLabel = app.eventDate
    ? `${formatDate(app.eventDate)}${app.tourEndDate ? ` – ${formatDate(app.tourEndDate)}` : ''}`
    : ''
  const paymentStatus =
    !pay || app.payment.mode === 'None' ? null
      : pay.status === 'Paid' ? `PAID · Receipt ${pay.receiptNos.join(', ') || '—'}`
        : pay.status === 'Awaiting Verification' ? `PAYMENT PENDING · Receipt ${pay.pendingReceiptNo ?? '—'} (cash — under verification)`
          : 'NOT PAID'

  return {
    schoolName,
    logoText,
    affiliation: g.affiliation ?? '',
    address: g.address ?? '',
    contact: [g.phone && `Phone: ${g.phone}`, g.email && `E-mail: ${g.email}`].filter(Boolean).join('  ·  '),
    destination: app.destination ?? '—',
    datesLabel,
    feeLabel: app.payment.mode === 'None' ? 'Nil' : formatINR(app.payment.amount),
    paymentStatus,
    emergency: sub ? String(sub.answers['t-emergency'] ?? '') : '',
    meal: sub ? String(sub.answers['t-meal'] ?? '') : '',
    motion: sub ? sub.answers['t-motion'] as boolean | undefined : undefined,
    medical: sub ? String(sub.answers['t-medical'] ?? '') : '',
    tourNote: app.tourInstructions ?? '',
  }
}

// ─── The document ───────────────────────────────────────────────────────

export interface TourFormDocumentProps {
  app: SchoolApplication
  sub?: ApplicationSubmission
  /** Pre-resolved payment read-out for filled copies (optional). */
  payment?: SubmissionPaymentInfo
}

export function TourFormDocument({ app, sub, payment }: TourFormDocumentProps) {
  // Idempotent global styles for the clone-and-print strategy.
  useEffect(() => {
    const styleId = 'tour-print-style'
    if (!document.getElementById(styleId)) {
      const el = document.createElement('style')
      el.id = styleId
      el.textContent = `
        #print-root { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
          body.tour-printing > *:not(#print-root) { display: none !important; }
          body.tour-printing #print-root { display: block !important; }
          .tour-print-doc { box-shadow: none !important; }
        }`
      document.head.appendChild(el)
    }
  }, [])

  const k = docTemplateOf(app) === 'modern' ? MODERN : CLASSIC
  const m = useDocModel(app, sub, payment)

  return (
    <div
      className="tour-print-doc bg-white"
      style={{
        width: '210mm', minHeight: '297mm', boxSizing: 'border-box',
        padding: k.pagePadding, color: '#111',
        fontFamily: 'Georgia, "Times New Roman", serif',
      }}
    >
      <Header m={m} k={k} />
      <CircularRow app={app} k={k} />
      <TitleBlock app={app} sub={sub} m={m} k={k} />

      {/* ── Tour information ── */}
      <SectionTitle k={k}>Tour Information</SectionTitle>
      <RowGrid k={k}>
        <DocRow label="Destination" k={k}>{m.destination}</DocRow>
        <DocRow label="Travel dates" k={k}>{m.datesLabel || undefined}</DocRow>
        <DocRow label="Duration" k={k}>{app.durationDays || undefined}</DocRow>
        <DocRow label="Tour fee per student" k={k}>
          <span style={{ fontWeight: 700 }}>{m.feeLabel}</span>
        </DocRow>
        <DocRow label="Teacher / tour in-charge" k={k}>{app.inChargeName || undefined}</DocRow>
        <DocRow label="Accompanying staff" k={k}>{app.accompanyingStaff || undefined}</DocRow>
      </RowGrid>
      {m.tourNote && (
        <p style={{ fontSize: k === MODERN ? '8.5px' : '8.5px', lineHeight: 1.5, color: '#3a3a3a', marginTop: k === MODERN ? '2.2mm' : '1.2mm' }}>
          <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '7.5px' }}>Note:&nbsp;</span>
          {m.tourNote}
        </p>
      )}

      {/* ── Student details ── */}
      <SectionTitle k={k}>Student Details</SectionTitle>
      <RowGrid k={k}>
        <DocRow label="Student name" k={k} wide>
          {sub?.studentName ? <span style={{ fontWeight: 700 }}>{sub.studentName}</span> : undefined}
        </DocRow>
        <DocRow label="Admission no." k={k}>
          {sub?.admissionNo
            ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '9px' }}>{sub.admissionNo}</span>
            : undefined}
        </DocRow>
        <DocRow label="Class / section" k={k}>
          {sub ? `${sub.className} — ${sub.section}` : undefined}
        </DocRow>
        <DocRow label="Roll no." k={k}>{sub?.rollNo || undefined}</DocRow>
        <DocRow label="Blood group" k={k}>{sub?.bloodGroup || undefined}</DocRow>
      </RowGrid>

      {/* ── Parent / guardian details ── */}
      <SectionTitle k={k}>Parent / Guardian Details</SectionTitle>
      <RowGrid k={k}>
        <DocRow label="Parent / guardian name" k={k}>{sub?.guardianName || undefined}</DocRow>
        <DocRow label="Mobile number" k={k}>{sub?.guardianPhone || undefined}</DocRow>
        <DocRow label="Residential address" k={k} wide>{sub?.address || undefined}</DocRow>
        <DocRow label="Emergency contact" k={k} wide>{m.emergency || undefined}</DocRow>
      </RowGrid>

      {/* ── Health / care information ── */}
      <SectionTitle k={k}>Health / Care Information</SectionTitle>
      <RowGrid k={k}>
        <DocRow label="Food preference" k={k}>{m.meal || undefined}</DocRow>
        <DocRow label="Motion sickness" k={k}>
          {sub
            ? m.motion === undefined ? '—' : m.motion ? 'Yes — see note' : 'No'
            : undefined}
        </DocRow>
        <DocRow label="Health / medical note" k={k} wide>{m.medical || (sub ? '—' : undefined)}</DocRow>
      </RowGrid>

      <Declaration app={app} sub={sub} m={m} k={k} />
      <SignatureArea app={app} sub={sub} k={k} />
      <OfficeUse app={app} sub={sub} k={k} paymentStatus={m.paymentStatus} />
    </div>
  )
}

// ─── Variant blocks ─────────────────────────────────────────────────────

/** A. School header — emblem · name · affiliation · address · photo box. */
function Header({ m, k }: { m: DocModel; k: DocSkin }) {
  if (k === MODERN) {
    return (
      <>
        <div className="flex items-start justify-between" style={{ gap: '5mm' }}>
          {/* emblem — single hairline circle */}
          <div
            className="shrink-0 flex items-center justify-center"
            style={{
              width: '11mm', height: '11mm', border: '0.25mm solid #444', borderRadius: '50%',
              fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.04em',
            }}
          >
            {m.logoText}
          </div>
          {/* name · affiliation · address · contact (centred block) */}
          <div className="flex-1 text-center min-w-0">
            <p style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 1.15 }}>
              {m.schoolName}
            </p>
            {m.affiliation && <p style={{ fontSize: '8px', marginTop: '1mm', color: '#4a4a4a', letterSpacing: '0.03em' }}>{m.affiliation}</p>}
            {(m.address || m.contact) && (
              <p style={{ fontSize: '7.5px', marginTop: '1mm', color: '#666', lineHeight: 1.5 }}>
                {m.address}
                {m.address && m.contact ? '  ·  ' : ''}
                {m.contact}
              </p>
            )}
          </div>
          <PhotoBox k={k} />
        </div>
        {/* single hairline, generous space below */}
        <div style={{ borderTop: '0.18mm solid #c9c9c9', marginTop: '3.5mm' }} />
      </>
    )
  }
  // CLASSIC — the formal office letterhead with the double-ring emblem.
  return (
    <>
      <div className="flex items-start justify-between" style={{ gap: '4mm' }}>
        {/* emblem — double ring */}
        <div
          className="shrink-0 flex items-center justify-center"
          style={{ width: '15mm', height: '15mm', border: '0.4mm solid #333', borderRadius: '50%' }}
        >
          <div
            className="flex items-center justify-center"
            style={{ width: '12mm', height: '12mm', border: '0.2mm solid #444', borderRadius: '50%', fontSize: '10px', fontWeight: 700, letterSpacing: '0.03em' }}
          >
            {m.logoText}
          </div>
        </div>
        {/* name · affiliation · address · contact */}
        <div className="flex-1 text-center min-w-0">
          <p style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.1 }}>
            {m.schoolName}
          </p>
          {m.affiliation && <p style={{ fontSize: '8.5px', marginTop: '0.8mm', color: '#333' }}>{m.affiliation}</p>}
          {m.address && <p style={{ fontSize: '8px', marginTop: '0.6mm', color: '#444' }}>{m.address}</p>}
          {m.contact && <p style={{ fontSize: '8px', color: '#444' }}>{m.contact}</p>}
        </div>
        {/* student photograph */}
        <PhotoBox k={k} />
      </div>
    </>
  )
}

/** Circular / ref no. row — classic: between two strong rules; modern: one hairline above. */
function CircularRow({ app, k }: { app: SchoolApplication; k: DocSkin }) {
  if (k === MODERN) {
    return (
      <div className="flex items-center justify-between"
        style={{ padding: '1.8mm 0.5mm 0.5mm' }}
      >
        <p style={{ fontSize: '9px', color: '#333' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.06em' }}>Ref. No.&nbsp;</span>
          {app.circularNo || '\u00A0'}
        </p>
        <p style={{ fontSize: '9px', color: '#333' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.06em' }}>Dated&nbsp;</span>
          {app.circularDate ? formatDate(app.circularDate) : '\u00A0'}
        </p>
      </div>
    )
  }
  return (
    <>
      <div style={{ borderTop: '0.3mm solid #333', marginTop: '2mm' }} />
      <div className="flex items-center justify-between" style={{ padding: '1.1mm 0.5mm' }}>
        <p style={{ fontSize: '10px' }}>
          <span style={{ fontWeight: 700 }}>Circular / Ref. No.:</span>{' '}
          {app.circularNo || '\u00A0'}
        </p>
        <p style={{ fontSize: '10px' }}>
          <span style={{ fontWeight: 700 }}>Date:</span>{' '}
          {app.circularDate ? formatDate(app.circularDate) : '\u00A0'}
        </p>
      </div>
      <div style={{ borderTop: '0.5mm solid #111' }} />
    </>
  )
}

/** B. Form title — classic: bold caps underlined; modern: airy letterspaced caps. */
function TitleBlock({ app, sub, m, k }: { app: SchoolApplication; sub?: ApplicationSubmission; m: DocModel; k: DocSkin }) {
  if (k === MODERN) {
    return (
      <div className="text-center" style={{ marginTop: '7mm', marginBottom: '1.5mm' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.34em', textTransform: 'uppercase' }}>
          Parent Consent Form
        </p>
        <p style={{ fontSize: '10px', marginTop: '1.6mm', color: '#3c3c3c' }}>
          Educational Tour — {m.destination}
        </p>
        {sub && (
          <p style={{ fontSize: '8px', marginTop: '1.4mm', color: '#6a6a6a', letterSpacing: '0.08em' }}>
            Application No. <span style={{ fontWeight: 700, color: '#111' }}>{sub.serialNo ?? sub.id}</span>
            {'  ·  '}Session {app.academicYear}
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="text-center" style={{ marginTop: '3.2mm' }}>
      <p style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.14em' }}>
        PARENT CONSENT FORM
      </p>
      <p style={{ fontSize: '12px', marginTop: '0.4mm', color: '#222' }}>सहमति पत्र</p>
      <p style={{ fontSize: '11px', marginTop: '1.2mm', fontWeight: 700 }}>
        Educational Tour — {m.destination}
      </p>
      {sub && (
        <p style={{ fontSize: '8.5px', marginTop: '0.8mm', color: '#555', letterSpacing: '0.05em' }}>
          Application No. <span style={{ fontWeight: 700, color: '#111' }}>{sub.serialNo ?? sub.id}</span>
          {' · '}Session {app.academicYear}
        </p>
      )}
    </div>
  )
}

/** G. Parental undertaking & declaration — classic: the single boxed block; modern: open list. */
function Declaration({ app: _app, sub, m, k }: { app: SchoolApplication; sub?: ApplicationSubmission; m: DocModel; k: DocSkin }) {
  const body = (
    <>
      <p style={{ fontSize: k.declSize, lineHeight: k.declLeading, color: '#111' }}>
        I/We, <span style={{ fontWeight: 700 }}>{sub?.guardianName || '\u00A0'}</span>,
        parent/guardian of <span style={{ fontWeight: 700 }}>{sub?.studentName || '\u00A0'}</span>
        {' '}of <span style={{ fontWeight: 700 }}>{sub ? `${sub.className} — ${sub.section}` : '\u00A0'}</span>,
        hereby declare and undertake as follows:
      </p>
      <ol style={{ fontSize: k.declSize, lineHeight: k.declLeading, color: '#111', margin: k === MODERN ? '1.6mm 0 0 5mm' : '1mm 0 0 5mm', paddingLeft: 0 }}>
        <li>I/We give full consent for my/our ward to participate in the Educational Tour to <span style={{ fontWeight: 700 }}>{m.destination}</span>{m.datesLabel ? ` (${m.datesLabel})` : ''} organised by the school.</li>
        <li>The particulars furnished above are true and correct to the best of my/our knowledge.</li>
        <li>I/We have noted the tour dates, the fee payable and the conditions stated in the school circular.</li>
        <li>In case of illness or emergency during the tour, I/We authorise the school and the escorting staff to secure necessary medical assistance and treatment for my/our ward.</li>
        <li>My/our ward shall abide by the school&apos;s rules and the instructions of the escorting staff throughout the tour.</li>
      </ol>
      <p style={{ fontSize: '8.5px', marginTop: k === MODERN ? '2.4mm' : '1.2mm', color: '#333' }}>
        Place: ________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date: ________________
      </p>
    </>
  )
  return (
    <>
      <SectionTitle k={k}>Parental Undertaking &amp; Declaration</SectionTitle>
      {k.declBoxed ? (
        <div style={{ border: '0.3mm solid #333', padding: '1.8mm 2.4mm' }}>{body}</div>
      ) : (
        <div style={{ marginTop: '0.4mm' }}>{body}</div>
      )}
    </>
  )
}

/** H. Signature area — student · parent/guardian · class teacher / in-charge. */
function SignatureArea({ app, sub, k }: { app: SchoolApplication; sub?: ApplicationSubmission; k: DocSkin }) {
  const cols = [
    { who: 'Student\u2019s Signature', name: sub?.studentName },
    { who: 'Parent / Guardian\u2019s Signature', name: sub?.guardianName, sig: sub?.signature },
    { who: 'Class Teacher / Tour In-charge', name: app.inChargeName },
  ] as Array<{ who: string; name?: string; sig?: ApplicationSubmission['signature'] }>
  return (
    <div className="grid grid-cols-3" style={{ gap: k.sigGap, marginTop: k === MODERN ? '5.8mm' : '4mm' }}>
      {cols.map(({ who, name, sig }) => (
        <div key={who} className="text-center">
          <div style={{
            height: k.sigHeight,
            borderBottom: k.sigRule,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '0.5mm',
          }}>
            {sig && sig.mode === 'drawn' && sig.data.startsWith('data:image/png') ? (
              <img src={sig.data} alt={`Signature of ${sig.signerName}`} style={{ maxHeight: '9mm', maxWidth: '100%', objectFit: 'contain' }} />
            ) : sig && sig.mode === 'typed' ? (
              <span style={{ fontSize: '13px', fontStyle: 'italic' }}>{sig.data}</span>
            ) : null}
          </div>
          <p style={{ fontSize: '7.5px', fontWeight: 700, marginTop: '0.7mm' }}>{who}</p>
          <p style={{ fontSize: '7px', color: '#555' }}>
            {sig ? `Recorded online · ${formatDate(sig.signedAt)}` : name ? name : 'Name: ______________'}
          </p>
        </div>
      ))}
    </div>
  )
}

/** I. Office use — slim strip at the foot of the page. */
function OfficeUse({ app, sub, k, paymentStatus }: {
  app: SchoolApplication
  sub?: ApplicationSubmission
  k: DocSkin
  paymentStatus: string | null
}) {
  const verified =
    sub
      ? sub.physicalDoc.status === 'Verified' ? 'Verified'
        : sub.physicalDoc.status === 'Received' ? 'Received'
          : sub.status === 'Approved' ? 'Approved'
            : 'Pending'
      : undefined
  return (
    <div style={{ marginTop: k === MODERN ? '5.5mm' : '4mm', borderTop: k.officeRule, paddingTop: k === MODERN ? '2.4mm' : '1.2mm' }}>
      <p style={{
        fontSize: '8px', fontWeight: 700, letterSpacing: '0.16em',
        textAlign: k.officeCentered ? 'center' : 'left',
        color: k === MODERN ? '#5a5a5a' : '#111',
        textTransform: 'uppercase',
      }}>
        For Office Use Only
      </p>
      <RowGrid k={k}>
        <DocRow label="Application no." k={k}>{sub?.serialNo || undefined}</DocRow>
        <DocRow label="Payment status" k={k}>{paymentStatus ?? undefined}</DocRow>
        <DocRow label="Verified / received" k={k}>{verified || undefined}</DocRow>
        <DocRow label="Office date" k={k}>{sub ? formatDate(sub.submittedAt) : undefined}</DocRow>
      </RowGrid>
      <p style={{ fontSize: '7px', color: '#666', marginTop: k === MODERN ? '1.6mm' : '0.6mm', textAlign: k.officeCentered ? 'center' : 'right' }}>
        Detach and retain with the office record · {app.academicYear}
      </p>
    </div>
  )
}
