// ============================================================
// 8B-7-e — Central email infrastructure: TEMPLATES
// ------------------------------------------------------------
// renderTemplate(template, props, branding) → { subject, html }.
//
// Design rules (mission §7):
//   · Plain-string HTML with a shared BRANDED WRAPPER — header (school
//     name + optional absolute-URL logo), monochrome-safe inline
//     styling (structure/typography carry the hierarchy; the tenant
//     primaryColor is decorative trim only, so the mail survives any
//     color-stripping client), footer 'Sent by <school> via Scholario'.
//   · ALL dynamic values HTML-escaped (escapeHtml below) — including
//     school name, colors, logo URL and every prop. Email bodies are
//     attacker-adjacent surfaces (public admission form), so this is
//     an XSS boundary, not cosmetics.
//   · Prop payloads validated with zod at RENDER time (same style as
//     the API routes' strictBody gates) — invalid/missing props throw
//     a plain Error which the sendEmail pipeline converts into a
//     FAILED EmailDelivery row. Unknown template ids throw likewise.
//   · Table-based layout (email-client compatible), no external CSS,
//     no remote fonts, no scripts, no tracking pixels.
// ============================================================

import { z } from 'zod'
import type { EmailBranding, EmailTemplateProps, RenderedEmail, TemplateId } from './types'

// ─── HTML escaping (the single security-relevant primitive here) ────────

/**
 * Escape every value that is interpolated into email HTML. Covers the
 * five characters that matter in element bodies AND in double-quoted
 * attributes (school names / props / URLs / colors all pass through
 * here before touching the document).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Reduce a claimed primary color to a strict hex shape before it is
 * embedded in an inline style. Anything else (including junk from a
 * tampered row) falls back to the neutral Scholario teal.
 */
export function sanitizeColor(color: string | undefined, fallback = '#0f766e'): string {
  if (typeof color !== 'string') return fallback
  const trimmed = color.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed
  return fallback
}

/**
 * Only absolute http(s) logo URLs survive into the mail — relative
 * paths (storage-backed logos resolve to /api/... routes here) would
 * render as broken images in every mail client. The header still
 * shows the school wordmark when the logo is dropped.
 */
export function absoluteLogoUrl(logoUrl: string | undefined): string | undefined {
  if (typeof logoUrl !== 'string') return undefined
  const trimmed = logoUrl.trim()
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed
  return undefined
}

// ─── prop validation (render-time, zod — same style as route bodies) ────

const admissionEnquiryPropsSchema = z.object({
  studentName: z.string().trim().min(1).max(200),
  grade: z.string().trim().max(24).optional().default(''),
  contactEmail: z.string().trim().max(254).optional().default(''),
  referenceId: z.string().trim().max(64).optional().default(''),
})

const salaryPaymentPropsSchema = z.object({
  teacherName: z.string().trim().min(1).max(200),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM'),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'amount must be a plain decimal string like 12345.00'),
})

// ACCOUNT-RECOVERY — PlatformAdmin password reset. The resetUrl carries
// the raw single-use token; it is ONLY interpolated into the HTML (the
// dev-log transport logs subject/template, never the body) and the
// EmailDelivery row stores recipient+template only — never the token.
const platformPasswordResetPropsSchema = z.object({
  adminName: z.string().trim().min(1).max(200),
  resetUrl: z
    .string()
    .trim()
    .min(16)
    .max(2048)
    .regex(/^https?:\/\//, 'resetUrl must be an absolute http(s) URL'),
  expiresInMinutes: z.number().int().min(1).max(1440),
  requestIp: z.string().trim().max(60).optional().default(''),
})

// ─── shared branded wrapper ─────────────────────────────────────────────

const PAGE_BG = '#f4f4f5' // neutral outer margin (monochrome gray)
const CARD_BORDER = '#e4e4e7'
const TEXT_STRONG = '#18181b'
const TEXT_BODY = '#3f3f46'
const TEXT_MUTED = '#71717a'

/**
 * Shared envelope: header (logo + school name + short name), a
 * decorative primary-color top strip, the body cell, and the footer
 * 'Sent by <school> via Scholario'. Every dynamic value is escaped
 * before interpolation; `primaryColor` is sanitized to a hex shape.
 */
function brandedWrapper(branding: EmailBranding, bodyHtml: string): string {
  const schoolName = escapeHtml(branding.schoolName)
  const shortName =
    branding.shortName && branding.shortName.trim() && branding.shortName !== branding.schoolName
      ? escapeHtml(branding.shortName.trim())
      : ''
  const accent = escapeHtml(sanitizeColor(branding.primaryColor))
  const logo = absoluteLogoUrl(branding.logoUrl)

  const logoHtml = logo
    ? `<img src="${escapeHtml(logo)}" alt="${schoolName} logo" style="display:block;height:36px;max-width:140px;width:auto;margin:0 0 8px 0;border:0;outline:none;text-decoration:none;" />`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${schoolName}</title></head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${CARD_BORDER};border-top:4px solid ${accent};">
<tr>
<td style="padding:20px 28px;border-bottom:1px solid ${CARD_BORDER};">
${logoHtml}<div style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:${TEXT_STRONG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${schoolName}</div>${shortName ? `<div style="margin:2px 0 0 0;font-size:12px;line-height:1.3;color:${TEXT_MUTED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${shortName}</div>` : ''}
</td>
</tr>
<tr>
<td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${bodyHtml}
</td>
</tr>
<tr>
<td style="padding:16px 28px;border-top:1px solid ${CARD_BORDER};">
<div style="margin:0;font-size:12px;line-height:1.5;color:${TEXT_MUTED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Sent by ${schoolName} via Scholario</div>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// Shared body atom helpers (all inline styles; no classes — mail clients
// strip <style> blocks, so presentation lives on the elements).

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-size:16px;font-weight:700;line-height:1.4;color:${TEXT_STRONG};">${escapeHtml(text)}</h1>`
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:${TEXT_BODY};">${html}</p>`
}

function bullet(text: string): string {
  return `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:${TEXT_BODY};">${escapeHtml(text)}</li>`
}

// ─── 'admission-enquiry-received' ───────────────────────────────────────

function renderAdmissionEnquiry(
  props: z.infer<typeof admissionEnquiryPropsSchema>,
  branding: EmailBranding,
): RenderedEmail {
  const schoolName = branding.schoolName // raw for the subject line (plain text)
  const studentName = escapeHtml(props.studentName)
  const grade = escapeHtml(props.grade)
  const contactEmail = escapeHtml(props.contactEmail)
  const referenceId = escapeHtml(props.referenceId)

  const body = [
    heading('We received your admission enquiry'),
    paragraph(`Dear Parent / Guardian of <strong>${studentName}</strong>,`),
    paragraph(
      `Thank you for reaching out to ${escapeHtml(branding.schoolName)}. Your admission enquiry for ${studentName} has been received and is now with our admissions team.`,
    ),
    props.grade
      ? paragraph(`The enquiry is for admission to <strong>${grade}</strong>.`)
      : paragraph('The grade requested will be confirmed by our admissions team when they contact you.'),
    paragraph('Here is what happens next:'),
    `<ul style="margin:0 0 12px 0;padding:0 0 0 22px;">${[
      'Our admissions team reviews every enquiry carefully.',
      contactEmail
        ? `We will contact you at this email address and at the phone number you provided.`
        : 'We will contact you at the phone number you provided.',
      'Please keep your reference id handy when you get in touch — it helps us find your enquiry immediately.',
    ]
      .map(bullet)
      .join('')}</ul>`,
    referenceId
      ? paragraph(`Your reference id: <strong>${referenceId}</strong>`)
      : '',
    paragraph('We look forward to welcoming you to our school community.'),
  ]
    .filter(Boolean)
    .join('\n')

  return {
    subject: `We received your admission enquiry — ${schoolName}`,
    html: brandedWrapper(branding, body),
  }
}

// ─── 'salary-payment-recorded' ──────────────────────────────────────────

function renderSalaryPayment(
  props: z.infer<typeof salaryPaymentPropsSchema>,
  branding: EmailBranding,
): RenderedEmail {
  const teacherName = escapeHtml(props.teacherName)
  const month = escapeHtml(props.month)
  const amount = escapeHtml(props.amount)

  const body = [
    heading(`Salary payment recorded for ${props.month}`),
    paragraph(`Dear <strong>${teacherName}</strong>,`),
    paragraph(
      `This email confirms that your fixed monthly salary payment for ${month} has been recorded by ${escapeHtml(branding.schoolName)}.`,
    ),
    paragraph(`Recorded amount: <strong>\u20B9${amount}</strong>`),
    paragraph(
      'This is a confirmation of the salary payment entry. If you have any questions about this payment, please contact the school office.',
    ),
  ].join('\n')

  return {
    subject: `Salary recorded for ${props.month} — ${branding.schoolName}`,
    html: brandedWrapper(branding, body),
  }
}

// ─── 'platform-password-reset' ──────────────────────────────────────────

function renderPlatformPasswordReset(
  props: z.infer<typeof platformPasswordResetPropsSchema>,
  branding: EmailBranding,
): RenderedEmail {
  const adminName = escapeHtml(props.adminName)
  // The reset link: ONLY the href is the full URL; the display text is a
  // neutral label (long hex tokens make ugly, wrap-breaking link text).
  const resetHref = escapeHtml(props.resetUrl)
  const minutes = escapeHtml(String(props.expiresInMinutes))
  const requestIp = escapeHtml(props.requestIp)

  const body = [
    heading('Reset your Scholario platform password'),
    paragraph(`Dear <strong>${adminName}</strong>,`),
    paragraph(
      'A password reset was requested for your Scholario platform administrator account. Use the button below to choose a new password.',
    ),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr><td style="background:${sanitizeColor(branding.primaryColor)};border-radius:8px;">` +
      `<a href="${resetHref}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Reset your password</a>` +
      `</td></tr></table>`,
    paragraph(
      `This link expires in <strong>${minutes} minutes</strong> and can be used only once. If you did not request a password reset, you can safely ignore this email — your current password keeps working.`,
    ),
    requestIp
      ? paragraph(`Request originated from IP address <strong>${requestIp}</strong>.`)
      : '',
    paragraph(
      'For your security: after the reset, every active platform session for this account is signed out automatically.',
    ),
  ]
    .filter(Boolean)
    .join('\n')

  return {
    subject: 'Reset your Scholario platform password',
    html: brandedWrapper(branding, body),
  }
}

// ─── dispatcher ─────────────────────────────────────────────────────────

/**
 * Render one template. Throws a plain Error for programming-level
 * failures (unknown template id, prop payload that fails its zod
 * gate); the sendEmail pipeline catches and records them as FAILED
 * EmailDelivery rows — callers never see an exception escape
 * sendEmail itself.
 *
 * `props` accepts both the typed per-template payloads and plain
 * records — validation is RUNTIME (zod), so untyped callers cannot
 * smuggle invalid values past this boundary.
 */
export function renderTemplate(
  template: TemplateId,
  props: Record<string, unknown> | EmailTemplateProps,
  branding: EmailBranding,
): RenderedEmail {
  switch (template) {
    case 'admission-enquiry-received': {
      const parsed = admissionEnquiryPropsSchema.safeParse(props)
      if (!parsed.success) {
        throw new Error(
          `invalid props for template 'admission-enquiry-received': ${parsed.error.issues
            .map((i) => `${i.path.join('.') || 'props'}: ${i.message}`)
            .join('; ')}`,
        )
      }
      return renderAdmissionEnquiry(parsed.data, branding)
    }
    case 'salary-payment-recorded': {
      const parsed = salaryPaymentPropsSchema.safeParse(props)
      if (!parsed.success) {
        throw new Error(
          `invalid props for template 'salary-payment-recorded': ${parsed.error.issues
            .map((i) => `${i.path.join('.') || 'props'}: ${i.message}`)
            .join('; ')}`,
        )
      }
      return renderSalaryPayment(parsed.data, branding)
    }
    case 'platform-password-reset': {
      const parsed = platformPasswordResetPropsSchema.safeParse(props)
      if (!parsed.success) {
        throw new Error(
          `invalid props for template 'platform-password-reset': ${parsed.error.issues
            .map((i) => `${i.path.join('.') || 'props'}: ${i.message}`)
            .join('; ')}`,
        )
      }
      return renderPlatformPasswordReset(parsed.data, branding)
    }
    default: {
      // Exhaustiveness guard — TemplateId is a closed union, so this
      // only fires for untyped/cast callers (e.g. hostile input).
      const exhaustive: never = template
      throw new Error(`unknown email template: ${String(exhaustive)}`)
    }
  }
}
