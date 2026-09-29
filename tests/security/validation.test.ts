import { describe, test, expect } from 'bun:test'
import {
  parseJsonBody,
  parseValue,
  idSchema,
  emailSchema,
  newPasswordSchema,
  phoneSchema,
  safeText,
  boundedInt,
  amountSchema,
  strictBody,
  DEFAULT_MAX_BODY_BYTES,
} from '@/lib/security/validation'
import { z } from 'zod'
import { AppError } from '@/lib/security/errors'

function post(body: string, headers?: Record<string, string>): Request {
  return new Request('http://test.local/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body,
  })
}

describe('parseJsonBody — transport-level gates', () => {
  const schema = strictBody({
    email: emailSchema,
    password: z.string().min(1),
  })

  test('accepts a valid body and normalizes the email', async () => {
    const out = await parseJsonBody(post(JSON.stringify({ email: '  A@B.COM ', password: 'x' })), schema)
    expect(out.email).toBe('a@b.com')
    expect(out.password).toBe('x')
  })

  test('rejects malformed JSON', async () => {
    try {
      await parseJsonBody(post('{oops'), schema)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).code).toBe('INVALID_INPUT')
    }
  })

  test('rejects oversized payloads (hard cap)', async () => {
    const big = JSON.stringify({ email: 'a@b.com', password: 'x', junk: 'y'.repeat(300 * 1024) })
    try {
      await parseJsonBody(post(big), schema)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as AppError).code).toBe('PAYLOAD_TOO_LARGE')
      expect((e as AppError).status).toBe(413)
    }
  })

  test('route-level caps can lower but never raise the ceiling', async () => {
    const tiny = JSON.stringify({ email: 'a@b.com', password: 'x' })
    await expect(
      parseJsonBody(post(tiny), schema, { maxBytes: 4 })
    ).rejects.toBeInstanceOf(AppError)
    await expect(
      parseJsonBody(post(tiny), schema, { maxBytes: DEFAULT_MAX_BODY_BYTES * 100 })
    ).resolves.toBeTruthy()
  })

  test('rejects unexpected top-level fields (strict by default)', async () => {
    try {
      await parseJsonBody(post(JSON.stringify({ email: 'a@b.com', password: 'x', role: 'SUPER_ADMIN' })), schema)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_INPUT')
      expect((e as AppError).publicMessage).toContain('role')
    }
  })

  test('non-object bodies pass through schema validation (arrays fail object schemas)', async () => {
    await expect(parseJsonBody(post('[1,2,3]'), schema)).rejects.toBeInstanceOf(AppError)
  })
})

describe('shared primitives — reject the Phase-1 mandated classes of junk', () => {
  test('malformed ids are impossible (traversal, unicode, separators)', () => {
    for (const bad of ['', '   ', '../../../etc/passwd', 'a/b', 'a\\b', 'id;drop', 'x'.repeat(65), 'id with space', 'id😀']) {
      expect(idSchema.safeParse(bad).success).toBe(false)
    }
    for (const good of ['clxxx1234567890abcdef', 'order_123', 'abc-def', ' Stu-58 ']) {
      expect(idSchema.safeParse(good).success).toBe(true)
    }
  })

  test('invalid enums are rejected', () => {
    const role = z.enum(['PRINCIPAL', 'TEACHER', 'STUDENT'])
    expect(role.safeParse('PRINCIPAL').success).toBe(true)
    expect(role.safeParse('principal').success).toBe(false)
    expect(role.safeParse('SUPER_HACKER').success).toBe(false)
  })

  test('invalid numbers are rejected (NaN, out of bounds, non-integer)', () => {
    const n = boundedInt(1, 100)
    expect(n.safeParse('42').success).toBe(true) // coerced
    expect(n.safeParse('abc').success).toBe(false)
    expect(n.safeParse('NaN').success).toBe(false)
    expect(n.safeParse(0).success).toBe(false)
    expect(n.safeParse(101).success).toBe(false)
    expect(n.safeParse(1.5).success).toBe(false)
    expect(amountSchema.safeParse('0').success).toBe(false)
    expect(amountSchema.safeParse('-5').success).toBe(false)
    expect(amountSchema.safeParse('1000000000').success).toBe(false)
  })

  test('invalid dates are rejected', () => {
    const d = z.coerce.date()
    expect(d.safeParse('2024-06-01').success).toBe(true)
    expect(d.safeParse('not-a-date').success).toBe(false)
    expect(d.safeParse('NaN').success).toBe(false)
  })

  test('new-password policy: length + letter + digit', () => {
    expect(newPasswordSchema.safeParse('abcd1234').success).toBe(true)
    expect(newPasswordSchema.safeParse('12345678').success).toBe(false) // no letter
    expect(newPasswordSchema.safeParse('abcdefgh').success).toBe(false) // no digit
    expect(newPasswordSchema.safeParse('ab1').success).toBe(false) // too short
    expect(newPasswordSchema.safeParse('x'.repeat(129)).success).toBe(false) // too long
  })

  test('phone + free text shapes', () => {
    expect(phoneSchema.safeParse('+91 98765 43210').success).toBe(true)
    expect(phoneSchema.safeParse('<script>').success).toBe(false)
    expect(safeText(10).safeParse('ok').success).toBe(true)
    expect(safeText(10).safeParse('way too long for the cap').success).toBe(false)
    expect(safeText(10).safeParse('ctrl\u0000char').success).toBe(false)
  })

  test('parseValue labels the failing field', () => {
    try {
      parseValue('../../etc/passwd', idSchema, 'fileId')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as AppError).publicMessage).toContain('fileId')
    }
  })
})
