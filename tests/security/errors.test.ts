import { describe, test, expect } from 'bun:test'
import {
  AppError,
  classifyError,
  isSafeClientMessage,
  newRequestId,
} from '@/lib/security/errors'

describe('isSafeClientMessage — unsafe-message heuristics', () => {
  test('accepts ordinary route-authored UX copy', () => {
    expect(isSafeClientMessage('Subject and message are required')).toBe(true)
    expect(isSafeClientMessage('Invalid email or password')).toBe(true)
  })
  test('rejects filesystem paths, Prisma internals, stack frames, secrets', () => {
    for (const bad of [
      'Cannot read file /home/z/my-project/db/uploads/x.png',
      'PrismaClient known error',
      "Invalid `prisma.user.findMany()` invocation",
      'Error: boom\n    at fn (/app/x.js:1:2)',
      'Unique constraint failed on the fields: (`email`)',
      'connect ECONNREFUSED 127.0.0.1:5432',
      'secret=abc123',
      'passwordHash mismatch',
      'x'.repeat(301),
    ]) {
      expect(isSafeClientMessage(bad)).toBe(false)
    }
  })
})

describe('classifyError — status mapping + sanitization', () => {
  test('legacy sentinels map to 401/403/404 with safe messages', () => {
    expect(classifyError(new Error('UNAUTHORIZED'), 'r').status).toBe(401)
    expect(classifyError(new Error('FORBIDDEN'), 'r').status).toBe(403)
    expect(classifyError(new Error('NO_SCHOOL'), 'r').status).toBe(403)
    expect(classifyError(new Error('NOT_FOUND'), 'r').status).toBe(404)
  })

  test('Prisma engine errors never surface raw', () => {
    const prismaErr = Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
      code: 'P2002',
      clientVersion: '6.11.1',
    })
    const c = classifyError(prismaErr, 'r')
    expect(c.status).toBe(409)
    expect(c.publicMessage).not.toContain('Unique constraint')
    expect(c.internalDetail).toContain('P2002')

    const missing = Object.assign(new Error('An operation failed because it depends on records that do not exist'), {
      code: 'P2025',
    })
    expect(classifyError(missing, 'r').status).toBe(404)

    const other = Object.assign(new Error('Internal row corruption'), { code: 'P2010' })
    const c2 = classifyError(other, 'r')
    expect(c2.status).toBe(500)
    expect(c2.publicMessage).toBe('Internal server error')
  })

  test('safe route messages surface as 400; unsafe ones collapse to 500 generic', () => {
    expect(classifyError(new Error('amount must be a number between 1 and 500000'), 'r').status).toBe(400)
    const leaky = classifyError(new Error('failed to write /home/z/uploads/file.png'), 'r')
    expect(leaky.status).toBe(500)
    expect(leaky.publicMessage).toBe('Internal server error')
    expect(leaky.publicMessage).not.toContain('/home/z')
  })

  test('AppError carries status, headers and safe public message', () => {
    const err = new AppError('RATE_LIMITED', {
      publicMessage: 'Too many requests. Please try again in 60s.',
      headers: { 'Retry-After': '60' },
    })
    const c = classifyError(err, 'req-1')
    expect(c.status).toBe(429)
    expect(c.headers?.['Retry-After']).toBe('60')
    expect(c.headers?.['X-Request-Id']).toBe('req-1')
  })

  test('every classified failure includes a request correlation id', () => {
    const rid = newRequestId()
    expect(rid).toBeTruthy()
    const c = classifyError(new Error('boom'), rid)
    expect(c.requestId).toBe(rid)
    expect(c.headers?.['X-Request-Id']).toBe(rid)
  })

  test('non-Error throwables collapse to safe 500s', () => {
    const c = classifyError({ weird: 'object' }, 'r')
    expect(c.status).toBe(500)
    expect(c.publicMessage).toBe('Internal server error')
    expect(c.publicMessage).not.toContain('weird')
  })
})
