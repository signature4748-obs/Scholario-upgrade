/**
 * PHASE 4 (item 10) — UNIT tests: the redaction layer.
 *
 * Pure-function scope: NO database, NO HTTP.
 *
 * Contract under test (src/lib/observability/redact.ts):
 *   · the sensitive-key vocabulary ([REDACTED] on password/token/secret/
 *     cookie/authorization/signature/session/apikey/… — case-insensitive,
 *     applied at EVERY nesting level)
 *   · string truncation above 2000 chars
 *   · depth cap at 4, array width cap at 50
 *   · Error → { name, message } only (stack dropped — paths leak)
 *   · Date → ISO string, BigInt → string, symbols/functions → string,
 *     non-plain objects degrade to safe output
 *   · redactDetail(): hex64 tokens / sk- keys / key:value secrets scrubbed
 */
import { describe, test, expect } from 'bun:test'
import { redact, redactDetail, REDACTED } from '@/lib/observability/redact'

describe('redact · sensitive-key vocabulary', () => {
  const SENSITIVE_KEYS = [
    'password', 'passwd', 'pass', 'secret', 'token', 'accessToken',
    'authorization', 'cookie', 'credential', 'credentials', 'apiKey',
    'api_key', 'api-key', 'privateKey', 'private_key', 'signature',
    'otp', 'cvv', 'salt', 'hash', 'session', 'sessionId', 'refresh',
    'refreshToken', 'accessKey', 'access_key', 'rawPayload', 'rawBody',
    'paToken', 'pa_token',
  ]

  test('every sensitive key maps its value to [REDACTED]', () => {
    for (const key of SENSITIVE_KEYS) {
      const out = redact({ [key]: 'leaky-value' })
      expect(out[key]).toBe(REDACTED)
      expect(JSON.stringify(out)).not.toContain('leaky-value')
    }
  })

  test('sensitive-key matching is case-insensitive and suffix-tolerant', () => {
    const out = redact({
      UserPassword: 'x1', ADMIN_TOKEN: 'x2', 'x-session-id': 'x3',
      bearerToken: 'x4', mySecretValue: 'x5', PasswordHash2: 'x6',
    })
    for (const v of Object.values(out)) expect(v).toBe(REDACTED)
  })

  test('benign keys keep their values', () => {
    const out = redact({ durationMs: 12, status: 200, note: 'fine', attempts: 3 })
    expect(out).toEqual({ durationMs: 12, status: 200, note: 'fine', attempts: 3 })
  })
})

describe('redact · nested structures', () => {
  test('nested sensitive keys are redacted at every level', () => {
    const out = redact({
      level1: { token: 't1', keep: 'ok', level2: { password: 'p1', level3: [{ secret: 's1' }, { fine: 1 }] } },
    }) as Record<string, any>
    expect(out.level1.token).toBe(REDACTED)
    expect(out.level1.keep).toBe('ok')
    expect(out.level1.level2.password).toBe(REDACTED)
    expect(out.level1.level2.level3[0].secret).toBe(REDACTED)
    expect(out.level1.level2.level3[1].fine).toBe(1)
    expect(JSON.stringify(out)).not.toContain('t1')
    expect(JSON.stringify(out)).not.toContain('p1')
    expect(JSON.stringify(out)).not.toContain('s1')
  })

  test('arrays wider than 50 items are summarized', () => {
    const arr = Array.from({ length: 60 }, (_, i) => i)
    const out = redact({ items: arr }) as { items: unknown[] }
    expect(out.items.length).toBe(51) // 50 + summary marker
    expect(out.items[50]).toBe('[+10 more]')
  })

  test('depth is capped at 4 — the 5th level becomes [max-depth]', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'bottom' } } } } } }
    const out = redact({ deep }) as any
    expect(out.deep.a.b.c.d).toBe('[max-depth]')
    expect(JSON.stringify(out)).not.toContain('bottom')
  })

  test('shallow objects are preserved exactly (cap does not bite)', () => {
    const out = redact({ a: { b: { c: 1 } } }) as any
    expect(out.a.b.c).toBe(1)
  })
})

describe('redact · value kinds', () => {
  test('Error → { name, message } only, never the stack', () => {
    const e = new Error('boom at /home/z/secret/path')
    e.stack = 'Error: boom\n    at fn (/home/z/my-project/src/x.ts:1:2)'
    const out = redact({ err: e }) as { err: { name: string; message: string } }
    expect(out.err.name).toBe('Error')
    expect(out.err.message).toBe('boom at /home/z/secret/path')
    expect(JSON.stringify(out)).not.toContain('at fn')
    expect(JSON.stringify(out)).not.toContain('/home/z/my-project')
  })

  test('Date → ISO string', () => {
    const d = new Date('2026-02-02T10:00:00.000Z')
    expect(redact({ at: d }).at).toBe('2026-02-02T10:00:00.000Z')
  })

  test('BigInt → string, Symbol/Function → string, non-finite numbers → string', () => {
    const out = redact({ n: 10n, s: Symbol('sym'), f: () => 1, nan: NaN, inf: Infinity })
    expect(out.n).toBe('10')
    expect(out.s).toBe('Symbol(sym)')
    expect(typeof out.f).toBe('string')
    expect(out.nan).toBe('NaN')
    expect(out.inf).toBe('Infinity')
  })

  test('null / undefined / booleans / finite numbers pass through', () => {
    expect(redact({ a: null, b: undefined, c: true, d: 0, e: -1.5 })).toEqual({
      a: null, b: undefined, c: true, d: 0, e: -1.5,
    })
  })

  test('exotic containers (Map/Set/class instances) never crash and never leak entries', () => {
    const out = redact({ m: new Map([['password', 'x']]), s: new Set([1, 2]) })
    expect(JSON.parse(JSON.stringify(out))).toEqual({ m: {}, s: {} })
  })

  test('strings above 2000 chars are truncated with a marker', () => {
    const out = redact({ blob: 'q'.repeat(2500) }) as { blob: string }
    expect(out.blob.length).toBe(2016) // 2000 + '…[truncated 500]'
    expect(out.blob.startsWith('q'.repeat(2000))).toBe(true)
    expect(out.blob.endsWith('[truncated 500]')).toBe(true)
  })

  test('strings at the boundary are untouched', () => {
    expect((redact({ s: 'x'.repeat(2000) }).s as string).length).toBe(2000)
    expect((redact({ s: 'x'.repeat(1999) }).s as string).length).toBe(1999)
  })
})

describe('redactDetail · message-string scrubbing', () => {
  test('64-hex tokens are scrubbed (session tokens / HMAC digests)', () => {
    const hex64 = 'a'.repeat(64)
    const out = redactDetail(`verify failed for ${hex64} at gateway`)
    expect(out).not.toContain(hex64)
    expect(out).toContain('[redacted-token]')
  })

  test('longer hex runs are also scrubbed (defensive)', () => {
    const out = redactDetail(`digest ${'f'.repeat(80)} end`)
    expect(out).not.toContain('f'.repeat(80))
  })

  test('sk- service keys are scrubbed', () => {
    const out = redactDetail('request signed with sk-abc123XYZ456 failed')
    expect(out).not.toContain('sk-abc123XYZ456')
    expect(out).toContain('[redacted-key]')
  })

  test('key:value secret pairs are scrubbed', () => {
    const cases: Array<[string, string]> = [
      ['password=hunter2', 'hunter2'],
      ['secret: letmein99', 'letmein99'],
      ['token=abc123def456', 'abc123def456'],
      ['authorization: Bearer sekrit', 'Bearer'],
    ]
    for (const [input, secret] of cases) {
      const out = redactDetail(input)
      expect(out).toContain('[redacted]')
      expect(out).not.toContain(secret)
    }
  })

  test('default cap is 400 (+ marker headroom), and a custom cap applies', () => {
    const long = 'a'.repeat(5000)
    expect(redactDetail(long).length).toBeLessThanOrEqual(400 + 64)
    expect(redactDetail(long, 50).length).toBeLessThanOrEqual(50 + 64)
  })

  test('ordinary diagnostic text passes through unmodified', () => {
    expect(redactDetail('P2002: unique constraint on (schoolId, receiptNo)')).toBe(
      'P2002: unique constraint on (schoolId, receiptNo)',
    )
  })
})
