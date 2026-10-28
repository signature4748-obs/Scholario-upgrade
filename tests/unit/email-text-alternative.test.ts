/**
 * EMAIL TEXT/PLAIN ALTERNATIVE — multipart/alternative deliverability tests.
 *
 * The deliverability patch (see docs/EMAIL.md) makes every template author
 * BOTH representations from the same validated props:
 *
 *   1. EVERY transactional template renders a non-empty, markup-free
 *      text part (compile-time required on RenderedEmail; asserted here
 *      at runtime so a careless template edit cannot silently regress).
 *   2. The recovery/confirmation pair keeps INFORMATION PARITY: the
 *      text alternative carries the same essential facts as the HTML —
 *      recipient name, school, reset URL, expiry, single-use notice,
 *      request-IP notice, session-revocation notice, footer.
 *   3. The reset URL appears in BOTH parts (link parity — text-only
 *      clients can still complete recovery) and NOWHERE else.
 *   4. Values are RAW in text (no escaping artifacts) and escaped in
 *      HTML (the XSS boundary stays in the HTML renderer only).
 *   5. Brand-anchored school recovery subjects.
 *   6. MIME STRUCTURE: the production Gmail path (nodemailer with
 *      text+html) composes multipart/alternative carrying both
 *      content-types — verified against real nodemailer in
 *      streamTransport mode (fully offline; no SMTP connection, no
 *      credentials, no network).
 *
 * SAFETY: no DB, no fetch, no secrets. The 'token' values below are
 * dummy fixture strings, never real reset tokens.
 */
import { describe, test, expect } from 'bun:test'
import { renderTemplate } from '@/lib/email/templates'
import type { EmailBranding, TemplateId } from '@/lib/email/types'

const BRANDING: EmailBranding = { schoolName: 'Hawkings High School Prithvipur', primaryColor: '#0f766e' }

const SCHOOL_RESET_URL =
  'https://scholario-app-virid.vercel.app/reset-password?token=deadbeefdeadbeef&from=%2Fs%2Fhawkings%2Flogin'
const PLATFORM_RESET_URL = 'https://scholario-platform.vercel.app/platform/reset-password?token=cafebabe'

/** Valid props for every template (closed set — mirrors TemplateId). */
const PROPS: Record<TemplateId, Record<string, unknown>> = {
  'admission-enquiry-received': {
    studentName: 'Aarav Sharma',
    grade: '9',
    contactEmail: 'parent@example.test',
    referenceId: 'AF-2026-0001',
  },
  'salary-payment-recorded': { teacherName: 'Rohan Mehta', month: '2026-01', amount: '12345.00' },
  'platform-password-reset': {
    adminName: 'Platform Admin',
    resetUrl: PLATFORM_RESET_URL,
    expiresInMinutes: 30,
    requestIp: '203.0.113.24',
  },
  'platform-recovery-link': {
    adminName: 'Platform Admin',
    resetUrl: 'https://scholario-platform.vercel.app/platform/recover?token=abc123def456',
    expiresInMinutes: 30,
  },
  'platform-password-changed': { adminName: 'Platform Admin' },
  'school-password-reset': {
    userName: 'Akash Aryan',
    resetUrl: SCHOOL_RESET_URL,
    expiresInMinutes: 30,
    requestIp: '203.0.113.24',
  },
  'school-password-changed': { userName: 'Akash Aryan' },
  'principal-invite': {
    principalName: 'Meera Nair',
    schoolName: 'Hawkings High School Prithvipur',
    loginUrl: 'https://scholario-app-virid.vercel.app/s/hawkings/login',
    tempPassword: 'bootstrap-pass-1',
    pendingActivation: false,
  },
}

const ALL_TEMPLATES = Object.keys(PROPS) as TemplateId[]

function render(template: TemplateId, props: Record<string, unknown> = PROPS[template]!, branding = BRANDING) {
  return renderTemplate(template, props, branding)
}

// ─── 1. every template ships both representations ────────────────────────

describe('text/plain alternative — every template', () => {
  test('renders non-empty markup-free text for all 8 transactional templates', () => {
    for (const template of ALL_TEMPLATES) {
      const rendered = render(template)
      expect(rendered.text.length, `${template}: text part empty`).toBeGreaterThan(0)
      expect(rendered.html.length, `${template}: html part empty`).toBeGreaterThan(0)
      // No markup and no escaping artifacts leak into the text part.
      expect(rendered.text, `${template}: raw '<' in text`).not.toContain('<')
      expect(rendered.text, `${template}: escaped entity in text`).not.toContain('&amp;')
      expect(rendered.text, `${template}: escaped entity in text`).not.toContain('&#39;')
    }
  })

  test('text part mirrors the branded footer of the HTML wrapper', () => {
    for (const template of ALL_TEMPLATES) {
      const rendered = render(template)
      expect(rendered.text, template).toContain('Sent by Hawkings High School Prithvipur via Scholario')
      expect(rendered.html, template).toContain('Sent by Hawkings High School Prithvipur via Scholario')
    }
  })
})

// ─── 2. recovery pair — information parity ───────────────────────────────

describe('text/plain alternative — school recovery pair parity', () => {
  test('school-password-reset: text carries the same essential facts as the HTML', () => {
    const rendered = render('school-password-reset')
    const t = rendered.text
    expect(t).toContain('Dear Akash Aryan,')
    expect(t).toContain('Hawkings High School Prithvipur')
    expect(t).toContain(SCHOOL_RESET_URL)
    expect(t).toContain('expires in 30 minutes')
    expect(t).toContain('only once')
    expect(t).toContain('Request originated from IP address 203.0.113.24.')
    expect(t).toContain('every active session for this account is signed out automatically')
    // Link parity: the URL is in BOTH parts. The text part shows the raw
    // URL; the HTML href escapes '&' → '&amp;' (pre-existing, correct —
    // browsers decode the entity, the link is functionally identical).
    expect(rendered.text).toContain(SCHOOL_RESET_URL)
    expect(rendered.html).toContain('reset-password?token=deadbeefdeadbeef')
    expect(rendered.html).toContain('&amp;from=%2Fs%2Fhawkings%2Flogin')
    // The URL appears as a plain link in text — no button label needed.
    expect(t).toContain('Open the link below to choose a new password')
  })

  test('school-password-changed: text carries the confirmation facts (no links — paper trail)', () => {
    const rendered = render('school-password-changed')
    const t = rendered.text
    expect(t).toContain('Dear Akash Aryan,')
    expect(t).toContain('Hawkings High School Prithvipur')
    expect(t).toContain('was just changed through a verified recovery link')
    expect(t).toContain('All active sessions for this account were signed out.')
    expect(t).toContain('sign in with your new password')
    expect(t).not.toContain('http') // no links in the notification by design
  })

  test('platform-password-reset and platform-recovery-link: text carries the reset URL too', () => {
    const reset = render('platform-password-reset')
    expect(reset.text).toContain(PLATFORM_RESET_URL)
    expect(reset.html).toContain(PLATFORM_RESET_URL)
    expect(reset.text).toContain('Request originated from IP address 203.0.113.24.')
    const recovery = render('platform-recovery-link')
    expect(recovery.text).toContain('platform/recover?token=abc123def456')
    expect(recovery.html).toContain('platform/recover?token=abc123def456')
  })

  test('requestIp absent → the IP line is omitted from BOTH parts (no fabricated data)', () => {
    const { requestIp: _omit, ...withoutIp } = PROPS['school-password-reset']!
    const rendered = render('school-password-reset', withoutIp)
    expect(rendered.text).not.toContain('IP address')
    expect(rendered.html).not.toContain('IP address')
  })
})

// ─── 3. brand-anchored recovery subjects ─────────────────────────────────

describe('subject branding — school recovery pair', () => {
  test('reset subject is brand-anchored', () => {
    expect(render('school-password-reset').subject).toBe('Scholario | Reset your school account password')
  })

  test('password-changed subject is brand-anchored', () => {
    expect(render('school-password-changed').subject).toBe('Scholario | Your school account password was changed')
  })

  test('every template subject carries the Scholario or school brand (consistency review)', () => {
    for (const template of ALL_TEMPLATES) {
      const { subject } = render(template)
      const branded = subject.includes('Scholario') || subject.includes('Hawkings High School Prithvipur')
      expect(branded, `${template}: unbranded subject '${subject}'`).toBe(true)
    }
  })
})

// ─── 4. escaping boundary stays in the HTML renderer ─────────────────────

describe('text/plain alternative — raw values, escaped HTML', () => {
  test('a school named with an ampersand renders literally in text, escaped in HTML', () => {
    const rendered = render('school-password-changed', { userName: 'Test User' }, {
      schoolName: 'A & B "Public" School',
      primaryColor: '#0f766e',
    })
    expect(rendered.text).toContain('A & B "Public" School') // raw, readable
    expect(rendered.html).toContain('A &amp; B &quot;Public&quot; School') // escaped
    expect(rendered.text).not.toContain('&amp;')
  })
})

// ─── 5. principal invite — bootstrap credential surfaces in BOTH parts ───

describe('text/plain alternative — principal invite', () => {
  test('server-generated one-time password appears in both parts; absent → shared-separately language', () => {
    const withPw = render('principal-invite')
    expect(withPw.text).toContain('Your one-time sign-in password is: bootstrap-pass-1')
    expect(withPw.html).toContain('bootstrap-pass-1')
    expect(withPw.text).toContain('https://scholario-app-virid.vercel.app/s/hawkings/login')

    const { tempPassword: _omit, ...withoutPw } = PROPS['principal-invite']!
    const noPw = render('principal-invite', withoutPw)
    expect(noPw.text).not.toContain('one-time sign-in password is:')
    expect(noPw.text).toContain('will be shared with you separately by the platform team')
  })
})

// ─── 6. MIME structure — the production Gmail path (offline) ─────────────

describe('MIME structure — nodemailer composes multipart/alternative from text+html', () => {
  test('both content-types present under a multipart/alternative root (no network)', async () => {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true })
    try {
      const rendered = render('school-password-reset')
      const info = await transporter.sendMail({
        from: 'Scholario <signature4748@gmail.com>',
        to: 'recipient@example.test',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
      const raw = (info as { message: Buffer }).message.toString('utf8')
      // nodemailer applies quoted-printable (soft breaks '=CRLF', '=3D'
      // for '=') — normalize before content assertions. The structural
      // assertion below is the deliverability contract: the production
      // Gmail path now emits multipart/alternative with BOTH parts.
      const decoded = raw.replace(/=\r\n/g, '').replace(/=3D/gi, '=')
      expect(decoded).toContain('multipart/alternative')
      expect(decoded).toContain('Content-Type: text/plain')
      expect(decoded).toContain('Content-Type: text/html')
      expect(decoded).toContain('Subject: Scholario | Reset your school account password')
      // Both parts are actually present, not just declared.
      expect(decoded).toContain('Open the link below to choose a new password')
      expect(decoded).toContain('Reset your school account password')
      // Link parity in the encoded stream: the plain-text part carries the
      // full, functional reset URL.
      expect(decoded).toContain(SCHOOL_RESET_URL)
    } finally {
      transporter.close()
    }
  })

  test('HTML-only content would NOT produce multipart/alternative (the pre-patch behavior)', async () => {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true })
    try {
      const info = await transporter.sendMail({
        from: 'Scholario <signature4748@gmail.com>',
        to: 'recipient@example.test',
        subject: 'html-only',
        html: '<p>legacy</p>',
      })
      const raw = (info as { message: Buffer }).message.toString('utf8')
      expect(raw).not.toContain('multipart/alternative')
    } finally {
      transporter.close()
    }
  })
})
