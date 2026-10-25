/**
 * blank-form-model — the canonical, versioned model behind the official
 * blank ADMISSION APPLICATION FORM.
 *
 * ONE model drives BOTH artefacts:
 *   · the real downloadable PDF  (lib/blank-form-pdf.ts)
 *   · the on-screen A4 preview    (AdmissionApplicationFormModal)
 *
 * Honesty rules (form contract):
 *   · School identity comes ONLY from the live tenant profile
 *     (server identity → local settings → neutral). Nothing is ever
 *     invented: no fake school names, no fake addresses, no fake
 *     registration/approval numbers, no government-approval claims.
 *   · Unconfigured identity fields are omitted or printed as labelled
 *     blanks — never fabricated.
 *   · The Aadhaar row appears ONLY when the school's document policy
 *     collects it ('required' | 'optional') and is always labelled
 *     "(Optional)" — the form never claims a legal obligation.
 *   · The document checklist reflects the school's configurable
 *     document policy (not-collected documents are omitted).
 *
 * VERSION CONTROL (scan compatibility):
 *   · BLANK_FORM_VERSION is stamped on every printed page footer.
 *   · Field LABELS are the OCR contract: `ocrFieldLabels` below is what
 *     lib/ocr-extract.ts matches scans against. Labels are APPEND-ONLY —
 *     a label may gain new synonyms but is never renamed or re-pointed
 *     at a different field key. Forms printed under an older version
 *     therefore keep mapping correctly after configuration changes
 *     (labels are matched by TEXT, not by page position).
 */

import {
  getCollectedDocuments,
  resolveDocumentPolicy,
  type AdmissionDocumentPolicy,
} from './documents'

/** Stable form schema version — printed on every page footer. */
export const BLANK_FORM_VERSION = 'AF-2026.1'

/** Tenant identity shape consumed by the model (structurally compatible
 * with lib/school-profile SchoolProfile — kept structural so this module
 * stays pure and unit-testable without the store). */
export interface BlankFormSchoolIdentity {
  name: string
  shortName?: string
  affiliation?: string
  address?: string
  city?: string
  phone?: string
  email?: string
  website?: string
  principal?: string
  logoUrl?: string | null
  primaryColor?: string | null
}

export type BlankFormFieldKind = 'line' | 'checkbox' | 'prefilled'

export interface BlankFormField {
  /** Wizard FormData key this line maps to on scan ('' = not OCR-mappable). */
  key: string
  /** Printed label — OCR-STABLE (must match an ocr-extract synonym). */
  label: string
  kind: BlankFormFieldKind
  /** Checkbox options printed beside the label. */
  options?: string[]
  /** Prefilled text (e.g. Nationality: Indian) — a default, never a claim. */
  prefill?: string
  /** True → printed with a required asterisk. */
  required?: boolean
  /** Small honest guidance under the label. */
  note?: string
  /** 1 = half-width column, 2 = full width. Default 1. */
  span?: 1 | 2
}

export interface BlankFormSection {
  key: 'A' | 'B' | 'C' | 'D' | 'E'
  title: string
  fields: BlankFormField[]
}

export interface BlankFormDocumentEntry {
  key: string
  name: string
  required: boolean
}

export interface BlankFormModel {
  version: string
  school: BlankFormSchoolIdentity
  /** Academic session string ('' → printed as a labelled blank). */
  session: string
  /** Prefix of the pre-printed form-number field, e.g. "ADM-2026". */
  formNoPrefix: string
  sections: BlankFormSection[]
  /** Documents the school collects (policy-resolved, display order). */
  documents: BlankFormDocumentEntry[]
  declaration: {
    /** Declaration text — names the actual tenant school. */
    text: string
    parentSignLabel: string
    officeSignLabel: string
    principalSignLabel: string
  }
  /** fieldKey → printed label. THE scan-alignment contract. */
  ocrFieldLabels: Record<string, string>
}

export interface BuildBlankFormInput {
  school: BlankFormSchoolIdentity
  /** Academic session; pass '' when the school has none configured. */
  session: string
  /** School's admission document policy (falls back to registry defaults). */
  documentPolicy?: Partial<AdmissionDocumentPolicy> | null
}

const ADMISSION_CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS']
const GENDERS = ['Male', 'Female', 'Other']
const TC_OPTIONS = ['Yes (enclosed)', 'No (to follow)', 'Not applicable']

/**
 * Build the canonical blank admission form model for a tenant.
 * Pure: no stores, no DOM, no network — fully unit-testable.
 */
export function buildBlankFormModel(input: BuildBlankFormInput): BlankFormModel {
  const { school, session } = input
  const policy = resolveDocumentPolicy(input.documentPolicy)
  const documents = getCollectedDocuments(input.documentPolicy)
  const aadhaarCollected = policy.aadhaar !== 'not-collected'

  const sections: BlankFormSection[] = [
    {
      key: 'A',
      title: 'SECTION A — STUDENT DETAILS',
      fields: [
        { key: 'firstName', label: 'First Name', kind: 'line', required: true, span: 1 },
        { key: 'lastName', label: 'Last Name', kind: 'line', required: true, span: 1 },
        { key: 'dob', label: 'Date of Birth', kind: 'line', required: true, note: 'dd / mm / yyyy', span: 1 },
        { key: 'gender', label: 'Gender', kind: 'checkbox', options: GENDERS, span: 1 },
        { key: 'bloodGroup', label: 'Blood Group', kind: 'line', span: 1 },
        {
          key: 'category',
          label: 'Category',
          kind: 'checkbox',
          options: ADMISSION_CATEGORIES,
          span: 2,
        },
        ...(aadhaarCollected
          ? [
              {
                key: 'aadhaarNo',
                label: 'Aadhaar Number',
                kind: 'line',
                // The form NEVER claims Aadhaar is legally required.
                note: '(Optional)',
                span: 2,
              } as BlankFormField,
            ]
          : []),
        { key: 'religion', label: 'Religion', kind: 'line', span: 1 },
        {
          key: 'nationality',
          label: 'Nationality',
          kind: 'prefilled',
          prefill: 'Indian',
          span: 1,
        },
        { key: 'className', label: 'Class Applying For', kind: 'line', required: true, span: 1 },
      ],
    },
    {
      key: 'B',
      title: 'SECTION B — PARENT / GUARDIAN DETAILS',
      fields: [
        { key: 'fatherName', label: "Father's Name", kind: 'line', required: true, span: 1 },
        { key: 'fatherOccupation', label: "Father's Occupation", kind: 'line', span: 1 },
        { key: 'fatherPhone', label: "Father's Mobile", kind: 'line', required: true, span: 1 },
        { key: 'fatherEmail', label: "Father's Email", kind: 'line', span: 1 },
        { key: 'motherName', label: "Mother's Name", kind: 'line', span: 1 },
        { key: 'motherOccupation', label: "Mother's Occupation", kind: 'line', span: 1 },
        { key: 'motherPhone', label: "Mother's Mobile", kind: 'line', span: 1 },
        { key: 'motherEmail', label: "Mother's Email", kind: 'line', span: 1 },
        { key: 'emergencyName', label: 'Emergency Contact Name', kind: 'line', span: 1 },
        { key: 'emergencyRelation', label: 'Relationship', kind: 'line', span: 1 },
        { key: 'emergencyPhone', label: 'Emergency Phone', kind: 'line', span: 2 },
      ],
    },
    {
      key: 'C',
      title: 'SECTION C — ADDRESS & PREVIOUS ACADEMIC RECORD',
      fields: [
        { key: 'currentAddress', label: 'Current Address', kind: 'line', required: true, span: 2 },
        { key: 'city', label: 'City / Town', kind: 'line', span: 1 },
        { key: 'district', label: 'District', kind: 'line', span: 1 },
        { key: 'state', label: 'State', kind: 'line', span: 1 },
        { key: 'pincode', label: 'Pincode', kind: 'line', span: 1 },
        { key: 'previousSchool', label: 'Previous School Name', kind: 'line', span: 2 },
        { key: 'previousClass', label: 'Last Class Passed', kind: 'line', span: 1 },
        { key: 'previousYear', label: 'Previous Academic Year', kind: 'line', span: 1 },
        { key: 'previousBoard', label: 'Previous Board', kind: 'line', span: 1 },
        { key: 'previousMarks', label: 'Previous Marks', kind: 'line', span: 1 },
        {
          key: '',
          label: 'Transfer Certificate',
          kind: 'checkbox',
          options: TC_OPTIONS,
          span: 2,
        },
      ],
    },
  ]

  // Section D — policy-driven document checklist (never a legal claim).
  const documentSection: BlankFormSection = {
    key: 'D',
    title: 'SECTION D — DOCUMENT CHECKLIST',
    fields: documents.map(
      (d): BlankFormField => ({
        key: '',
        label: d.name,
        kind: 'checkbox',
        required: d.required,
        note: d.required ? '(Required)' : '(Optional)',
        span: 2,
      })
    ),
  }

  // Section E — declaration & signatures (office-use block rendered by the
  // PDF/HTML painters; the model carries the text only).
  const declarationSection: BlankFormSection = {
    key: 'E',
    title: 'SECTION E — DECLARATION & SIGNATURES',
    fields: [],
  }

  const allSections = [...sections, documentSection, declarationSection]

  // OCR contract — every mappable printed label, key → label.
  const ocrFieldLabels: Record<string, string> = {}
  for (const section of sections) {
    for (const f of section.fields) {
      if (f.key && f.kind !== 'checkbox') ocrFieldLabels[f.key] = f.label
    }
  }

  return {
    version: BLANK_FORM_VERSION,
    school,
    session,
    formNoPrefix: `ADM-${session && session !== '—' ? session.slice(0, 4) : '____'}`,
    sections: allSections,
    documents: documents.map((d) => ({
      key: d.key,
      name: d.name,
      required: d.required,
    })),
    declaration: {
      text:
        `I/We declare that the information furnished in this form is true and complete ` +
        `to the best of my/our knowledge and belief. I/We understand that submission of ` +
        `this form does not by itself guarantee admission; admission is subject to ` +
        `verification of documents and availability of seats, and the decision of ` +
        `${school.name || 'the school'} shall be final. I/We agree to abide by the rules, ` +
        `discipline and fee regulations of ${school.name || 'the school'}.`,
      parentSignLabel: 'Signature of Parent / Guardian',
      officeSignLabel: 'Verified by (Admission Office)',
      principalSignLabel: 'Principal',
    },
    ocrFieldLabels,
  }
}
