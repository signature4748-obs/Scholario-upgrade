/**
 * OCR field extraction — maps recognized text lines onto canonical
 * admission-draft fields (the SAME FormData the wizard uses; there is no
 * second OCR data model).
 *
 * Honesty rules:
 * - Confidence values come from the OCR engine's own word/line
 *   confidence. Nothing is invented.
 * - Only fields actually found in the text are returned.
 * - The caller NEVER auto-submits; extracted values populate the draft
 *   for the Principal to verify.
 */

/** One recognized text line with the engine's confidence for it. */
export interface OcrLine {
  text: string
  /** 0–100 engine confidence for this line. */
  confidence: number
}

export interface ExtractedField {
  fieldKey: string
  label: string
  value: string
  confidence: number
  /** true when the engine's confidence for this value is below 85. */
  needsReview: boolean
}

/** Label synonyms → wizard field. Normalized (lowercase, no punctuation). */
const FIELD_SYNONYMS: Array<{
  fieldKey: string
  label: string
  synonyms: string[]
  /** Optional value cleaner (may reject the value by returning undefined) */
  clean?: (v: string) => string | undefined
}> = [
  {
    fieldKey: 'firstName',
    label: 'First Name',
    synonyms: ['first name', 'firstname', 'name of student', 'student name', 'student first name', 'candidates name', 'name'],
    clean: titleCase,
  },
  { fieldKey: 'lastName', label: 'Last Name', synonyms: ['last name', 'lastname', 'surname'], clean: titleCase },
  {
    fieldKey: 'fatherName',
    label: "Father's Name",
    synonyms: ['fathers name', 'father name', 'father', 'name of father', 'guardians name', 'guardian name'],
    clean: titleCase,
  },
  { fieldKey: 'motherName', label: "Mother's Name", synonyms: ['mothers name', 'mother name', 'mother', 'name of mother'], clean: titleCase },
  { fieldKey: 'fatherPhone', label: "Father's Phone", synonyms: ['fathers phone', 'father phone', 'fathers mobile', 'father mobile', 'mobile no', 'mobile number', 'contact no', 'contact number', 'phone no', 'phone number'], clean: cleanPhone },
  { fieldKey: 'motherPhone', label: "Mother's Phone", synonyms: ['mothers phone', 'mother phone', 'mothers mobile', 'mother mobile'], clean: cleanPhone },
  {
    fieldKey: 'fatherEmail',
    label: "Father's Email",
    // Bare "Email" defaults to the father/primary-contact email (the
    // printed official form always uses the distinct Father's/Mother's
    // labels; the fallback only fires on third-party forms).
    synonyms: ['fathers email', 'father email', 'fathers email id', 'email', 'email id'],
    clean: cleanEmail,
  },
  { fieldKey: 'motherEmail', label: "Mother's Email", synonyms: ['mothers email', 'mother email', 'mothers email id'], clean: cleanEmail },
  {
    fieldKey: 'fatherOccupation',
    label: "Father's Occupation",
    synonyms: ['fathers occupation', 'father occupation', 'occupation'],
    clean: titleCase,
  },
  { fieldKey: 'motherOccupation', label: "Mother's Occupation", synonyms: ['mothers occupation', 'mother occupation'], clean: titleCase },
  { fieldKey: 'emergencyName', label: 'Emergency Contact', synonyms: ['emergency contact', 'emergency contact name', 'emergency name'], clean: titleCase },
  { fieldKey: 'emergencyRelation', label: 'Relationship', synonyms: ['relationship', 'relation', 'emergency contact relationship'], clean: titleCase },
  {
    fieldKey: 'emergencyPhone',
    label: 'Emergency Phone',
    synonyms: ['emergency phone', 'emergency contact no', 'emergency contact number', 'emergency number', 'emergency mobile'],
    clean: cleanPhone,
  },
  { fieldKey: 'gender', label: 'Gender', synonyms: ['gender', 'sex'], clean: normalizeGender },
  { fieldKey: 'dob', label: 'Date of Birth', synonyms: ['date of birth', 'dob', 'birth date', 'd o b'], clean: normalizeDate },
  { fieldKey: 'religion', label: 'Religion', synonyms: ['religion'], clean: titleCase },
  { fieldKey: 'category', label: 'Category', synonyms: ['category', 'caste category'], clean: titleCase },
  { fieldKey: 'nationality', label: 'Nationality', synonyms: ['nationality'], clean: titleCase },
  { fieldKey: 'bloodGroup', label: 'Blood Group', synonyms: ['blood group', 'blood'], clean: normalizeBloodGroup },
  { fieldKey: 'aadhaarNo', label: 'Aadhaar Number', synonyms: ['aadhaar number', 'aadhaar no', 'aadhaar', 'aadhar number', 'aadhar no', 'aadhar', 'uid'], clean: normalizeAadhaar },
  { fieldKey: 'currentAddress', label: 'Address', synonyms: ['address', 'residential address', 'current address', 'correspondence address', 'home address'] },
  { fieldKey: 'city', label: 'City / Town', synonyms: ['city', 'town', 'city town', 'village'], clean: titleCase },
  { fieldKey: 'district', label: 'District', synonyms: ['district'], clean: titleCase },
  { fieldKey: 'state', label: 'State', synonyms: ['state'], clean: titleCase },
  { fieldKey: 'pincode', label: 'Pincode', synonyms: ['pincode', 'pin code', 'pin', 'zip code', 'zip'], clean: (v) => v.replace(/\D/g, '') },
  { fieldKey: 'previousSchool', label: 'Previous School', synonyms: ['previous school', 'previous school name', 'last school', 'school last attended', 'name of previous school', 'last school attended'], clean: titleCase },
  { fieldKey: 'previousClass', label: 'Last Class', synonyms: ['last class', 'last class passed', 'class studied', 'class passed', 'previous class'], clean: titleCase },
  { fieldKey: 'previousYear', label: 'Previous Session', synonyms: ['previous academic year', 'previous session', 'session', 'academic year', 'academic session'] },
  { fieldKey: 'previousBoard', label: 'Previous Board', synonyms: ['previous board', 'board'] },
  { fieldKey: 'previousMarks', label: 'Previous Marks', synonyms: ['previous marks', 'marks obtained', 'last exam marks', 'previous grades'] },
  { fieldKey: 'className', label: 'Applying For Class', synonyms: ['class applied for', 'applying for class', 'class applying for', 'admission sought for', 'class applied', 'class'] , clean: titleCase },
]

const LOW_CONFIDENCE_THRESHOLD = 85

function titleCase(v: string): string {
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ')
    .trim()
}

function normalizeGender(v: string): string | undefined {
  const s = v.trim().toLowerCase()
  // Exact readings only — a garbage token ("maybe") must NEVER become a
  // gender; the field is simply left for the Principal to fill.
  if (s === 'm' || s === 'male' || s === 'boy') return 'Male'
  if (s === 'f' || s === 'female' || s === 'girl') return 'Female'
  if (s === 'o' || s === 'other') return 'Other'
  return undefined
}

function normalizeDate(v: string): string | undefined {
  const s = v.trim()
  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy → yyyy-mm-dd (wizard format)
  const m = s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return undefined
}

function normalizeAadhaar(v: string): string | undefined {
  const digits = v.replace(/\D/g, '')
  if (digits.length === 12) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`
  }
  return undefined
}

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'A RH+', 'A RH-'])

/** Accept only a recognisable blood group — anything else is rejected
 * (never fabricate a medical value the engine could not read). */
function normalizeBloodGroup(v: string): string | undefined {
  const s = v.trim().toUpperCase().replace(/\s+/g, ' ')
  if (BLOOD_GROUPS.has(s)) return s
  // "O +" → "O+"
  const compact = s.replace(/ /g, '')
  if (BLOOD_GROUPS.has(compact)) return compact
  return undefined
}

function cleanEmail(v: string): string | undefined {
  const s = v.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined
}

function cleanPhone(v: string): string | undefined {
  const digits = v.replace(/\D/g, '')
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  // Unrecognised shapes stay as-is (still reviewable) when they look
  // like phone-like strings; pure garbage is rejected.
  return /[0-9]/.test(v) && digits.length >= 6 ? v.trim() : undefined
}

const normalizeLabel = (s: string) =>
  s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Split "Label : Value" / "Label - Value" / "Label  Value" (2+ spaces). */
function splitLabelValue(line: string): { label: string; value: string } | null {
  const m = line.match(/^\s*([A-Za-z][A-Za-z .'’/&]{1,40}?)\s*[:\-–—]\s*(.+?)\s*$/)
  if (m) return { label: m[1], value: m[2] }
  // "Label    Value" with wide gap (typical forms)
  const wide = line.match(/^\s*([A-Za-z][A-Za-z .'’/&]{1,40}?)\s{3,}(\S.*?)\s*$/)
  if (wide) return { label: wide[1], value: wide[2] }
  return null
}

/**
 * Match recognized lines onto admission draft fields.
 * Returns only the fields that were actually found.
 */
export function extractAdmissionFields(
  lines: OcrLine[],
  overallConfidence: number
): ExtractedField[] {
  const found = new Map<string, ExtractedField>()

  const put = (f: ExtractedField) => {
    if (!f.value || !f.value.trim()) return
    const existing = found.get(f.fieldKey)
    if (!existing || f.confidence > existing.confidence) found.set(f.fieldKey, f)
  }

  for (const line of lines) {
    const split = splitLabelValue(line.text)
    if (!split) continue
    const norm = normalizeLabel(split.label)

    for (const def of FIELD_SYNONYMS) {
      // Exact synonym match, or a contextual prefix ("student name",
      // "candidates name"). Deliberately NO loose suffix matching — a
      // bare "name" synonym must never capture "last name" or
      // "father's name" lines.
      const hit = def.synonyms.some((syn) => {
        if (norm === syn) return true
        return ['student', 'students', 'candidate', 'candidates', 'child', 'childs'].some(
          (p) => norm === `${p} ${syn}`
        )
      })
      if (!hit) continue
      const raw = split.value.trim()
      const value = def.clean ? def.clean(raw) : raw
      if (value === undefined || value === '') continue
      put({
        fieldKey: def.fieldKey,
        label: def.label,
        value,
        confidence: Math.round(line.confidence),
        needsReview: line.confidence < LOW_CONFIDENCE_THRESHOLD,
      })
      break
    }
  }

  // Pattern-based fallbacks for high-signal formats (Aadhaar / pincode /
  // phone / DOB) when the label didn't match.
  const fullText = lines.map((l) => l.text).join('\n')
  if (!found.has('aadhaarNo')) {
    const m = fullText.match(/\b(\d{4})\s(\d{4})\s(\d{4})\b/)
    if (m) {
      const line = lines.find((l) => l.text.includes(m[0]))
      found.set('aadhaarNo', {
        fieldKey: 'aadhaarNo',
        label: 'Aadhaar Number',
        value: m[0],
        confidence: Math.round(line?.confidence ?? overallConfidence),
        needsReview: (line?.confidence ?? overallConfidence) < LOW_CONFIDENCE_THRESHOLD,
      })
    }
  }
  if (!found.has('pincode')) {
    const line = lines.find((l) => /\b\d{6}\b/.test(l.text) && /pin|address/i.test(l.text))
    const m = line?.text.match(/\b(\d{6})\b/)
    if (m) {
      found.set('pincode', {
        fieldKey: 'pincode',
        label: 'Pincode',
        value: m[1],
        confidence: Math.round(line!.confidence),
        needsReview: line!.confidence < LOW_CONFIDENCE_THRESHOLD,
      })
    }
  }
  if (!found.has('fatherPhone')) {
    // A bare phone number maps to the father/primary contact — but NEVER
    // a number that sits on a mother/emergency/guardian labelled line
    // (that would silently cross-map parents).
    const isOtherContactLine = (l: OcrLine) =>
      /mother|emergency|guardian|landline|office/i.test(l.text)
    const line = lines.find(
      (l) =>
        !isOtherContactLine(l) &&
        (/\+91[\s-]?[6-9]\d{9}\b/.test(l.text.replace(/\s/g, '')) ||
          /([6-9]\d{9})\b/.test(l.text) ||
          /[6-9]\d{4}[\s-]\d{5}/.test(l.text))
    )
    const m = line?.text.replace(/\s/g, '').match(/(\+91)?([6-9]\d{9})/)
    if (m) {
      found.set('fatherPhone', {
        fieldKey: 'fatherPhone',
        label: "Father's Phone",
        value: m[2],
        confidence: Math.round(line!.confidence),
        needsReview: line!.confidence < LOW_CONFIDENCE_THRESHOLD,
      })
    }
  }
  if (!found.has('dob')) {
    const line = lines.find((l) => /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/.test(l.text))
    if (line) {
      const value = normalizeDate(line.text.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/)![0])
      if (value) {
        found.set('dob', {
          fieldKey: 'dob',
          label: 'Date of Birth',
          value,
          confidence: Math.round(line.confidence),
          needsReview: line.confidence < LOW_CONFIDENCE_THRESHOLD,
        })
      }
    }
  }

  return Array.from(found.values())
}

/** Flatten a tesseract.js result into lines with per-line confidence. */
export function flattenTesseractLines(blocks: unknown, fallbackText: string, overall: number): OcrLine[] {
  const lines: OcrLine[] = []
  try {
    for (const block of (blocks as any[]) || []) {
      for (const para of block?.paragraphs || []) {
        for (const line of para?.lines || []) {
          const text = (line?.text || '').trim()
          if (!text) continue
          const words: any[] = line?.words || []
          const confidence = words.length
            ? words.reduce((a, w) => a + (w.confidence ?? overall), 0) / words.length
            : overall
          lines.push({ text, confidence })
        }
      }
    }
  } catch {
    // fall through to text fallback
  }
  if (lines.length === 0 && fallbackText.trim()) {
    return fallbackText
      .split(/\n+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text, confidence: overall }))
  }
  return lines
}
