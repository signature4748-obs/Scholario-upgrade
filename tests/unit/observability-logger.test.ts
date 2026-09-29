/**
 * PHASE 4 (item 10) — UNIT tests: the structured logger.
 *
 * Pure-function scope: NO database, NO HTTP. Log output is captured by
 * monkey-patching console.log / console.warn / console.error (the
 * logger's only sinks) and restoring them in afterEach.
 *
 * Contract under test (src/lib/observability/logger.ts):
 *   · one single-line JSON object per log call with ts/channel/level/event
 *   · LOG_LEVEL filtering (default info) — restored after every test
 *   · correlation fields injected from the AsyncLocalStorage request
 *     context (requestId/userId/schoolId/route/operation)
 *   · context fields passed EXPLICITLY in `fields` are DROPPED —
 *     correlation identity can never be spoofed by a log caller
 *   · every field set flows through redact(): sensitive keys → [REDACTED],
 *     long strings truncated, depth capped
 *   · hostile field sets (throwing getters) degrade to a marker line —
 *     logging itself must never become a failure mode
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { log, logger } from '@/lib/observability/logger'
import { runInTestContext } from '@/lib/observability/context'

// ── console capture harness ─────────────────────────────────────────────

let captured: { sink: 'log' | 'warn' | 'error'; line: string }[]
let realLog: typeof console.log
let realWarn: typeof console.warn
let realError: typeof console.error

function parse(line: string): Record<string, unknown> {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    throw new Error(`log line is not single-line JSON: ${line.slice(0, 120)}`)
  }
}

beforeEach(() => {
  captured = []
  realLog = console.log
  realWarn = console.warn
  realError = console.error
  console.log = (s: unknown) => { captured.push({ sink: 'log', line: String(s) }) }
  console.warn = (s: unknown) => { captured.push({ sink: 'warn', line: String(s) }) }
  console.error = (s: unknown) => { captured.push({ sink: 'error', line: String(s) }) }
  delete process.env.LOG_LEVEL // default: info
})

afterEach(() => {
  console.log = realLog
  console.warn = realWarn
  console.error = realError
  delete process.env.LOG_LEVEL
})

// ── 1. line shape ────────────────────────────────────────────────────────

describe('logger · JSON line shape', () => {
  test('emits exactly one single-line JSON object with ts/channel/level/event', () => {
    logger.info('unit_event', { answer: 42 })
    expect(captured.length).toBe(1)
    expect(captured[0].sink).toBe('log')
    const entry = parse(captured[0].line)
    expect(entry.channel).toBe('app')
    expect(entry.level).toBe('info')
    expect(entry.event).toBe('unit_event')
    expect(entry.answer).toBe(42)
    expect(typeof entry.ts).toBe('string')
    expect(Number.isNaN(Date.parse(entry.ts as string))).toBe(false) // ISO timestamp
  })

  test('a caller-supplied channel string overrides the default channel', () => {
    log('info', 'evt', { channel: 'jobs', foo: 1 })
    expect(parse(captured[0].line).channel).toBe('jobs')
  })

  test('info → console.log, warn → console.warn, error → console.error', () => {
    logger.info('e1', {})
    logger.warn('e2', {})
    logger.error('e3', {})
    expect(captured.map((c) => c.sink)).toEqual(['log', 'warn', 'error'])
    expect(captured.map((c) => parse(c.line).level)).toEqual(['info', 'warn', 'error'])
  })

  test('event names and ordinary fields survive verbatim', () => {
    log('warn', 'http_request', { durationMs: 7, status: 200, operation: 'GET /api/x' })
    const entry = parse(captured[0].line)
    expect(entry.event).toBe('http_request')
    expect(entry.durationMs).toBe(7)
    expect(entry.status).toBe(200)
  })
})

// ── 2. level filtering ───────────────────────────────────────────────────

describe('logger · LOG_LEVEL filtering', () => {
  test('default level is info — debug is suppressed', () => {
    delete process.env.LOG_LEVEL
    logger.debug('suppressed_event', { x: 1 })
    logger.info('kept_event', {})
    expect(captured.length).toBe(1)
    expect(parse(captured[0].line).event).toBe('kept_event')
  })

  test('LOG_LEVEL=debug lets debug through', () => {
    process.env.LOG_LEVEL = 'debug'
    logger.debug('debug_event', {})
    expect(captured.length).toBe(1)
    expect(parse(captured[0].line).level).toBe('debug')
  })

  test('LOG_LEVEL=warn suppresses info and debug, keeps warn+error', () => {
    process.env.LOG_LEVEL = 'warn'
    logger.debug('d', {})
    logger.info('i', {})
    logger.warn('w', {})
    logger.error('e', {})
    expect(captured.map((c) => parse(c.line).event)).toEqual(['w', 'e'])
  })

  test('LOG_LEVEL=error suppresses everything below error', () => {
    process.env.LOG_LEVEL = 'error'
    logger.info('i', {})
    logger.warn('w', {})
    logger.error('e', {})
    expect(captured.length).toBe(1)
    expect(parse(captured[0].line).level).toBe('error')
  })

  test('an unrecognized LOG_LEVEL value falls back to info (never crashes)', () => {
    process.env.LOG_LEVEL = 'verbose-trace-11'
    logger.debug('d', {})
    logger.info('i', {})
    expect(captured.length).toBe(1)
    expect(parse(captured[0].line).event).toBe('i')
  })

  test('LOG_LEVEL is case-insensitive', () => {
    process.env.LOG_LEVEL = 'ERROR'
    logger.warn('w', {})
    logger.error('e', {})
    expect(captured.length).toBe(1)
    expect(parse(captured[0].line).event).toBe('e')
  })
})

// ── 3. request-context correlation injection ─────────────────────────────

describe('logger · request-context injection', () => {
  test('runInTestContext fields appear on every log line inside the scope', () => {
    runInTestContext(
      { requestId: 'req-unit-0001', userId: 'user-7', schoolId: 'school-9', route: '/api/unit', operation: 'GET /api/unit' },
      () => {
        logger.info('in_scope', {})
        logger.warn('also_in_scope', {})
      },
    )
    expect(captured.length).toBe(2)
    for (const c of captured) {
      const entry = parse(c.line)
      expect(entry.requestId).toBe('req-unit-0001')
      expect(entry.userId).toBe('user-7')
      expect(entry.schoolId).toBe('school-9')
      expect(entry.route).toBe('/api/unit')
      expect(entry.operation).toBe('GET /api/unit')
    }
  })

  test('outside any request scope no correlation fields are emitted', () => {
    logger.info('no_ctx', { foo: 'bar' })
    const entry = parse(captured[0].line)
    expect(entry.requestId).toBeUndefined()
    expect(entry.userId).toBeUndefined()
    expect(entry.schoolId).toBeUndefined()
    expect(entry.route).toBeUndefined()
    expect(entry.operation).toBeUndefined()
  })

  test('partial context (requestId only) injects only what exists', () => {
    runInTestContext({ requestId: 'partial-1234' }, () => logger.info('partial', {}))
    const entry = parse(captured[0].line)
    expect(entry.requestId).toBe('partial-1234')
    expect(entry.userId).toBeUndefined()
  })
})

// ── 4. anti-spoof: context fields are authoritative ──────────────────────

describe('logger · context fields cannot be spoofed via fields', () => {
  const SPOOF = {
    requestId: 'spoofed-request-id',
    userId: 'spoofed-user',
    schoolId: 'spoofed-school',
    route: '/spoofed/route',
    operation: 'SPOOF /operation',
  }

  test('spoofed context fields are dropped when a real context exists', () => {
    runInTestContext({ requestId: 'real-req-0001', userId: 'real-user', schoolId: 'real-school' }, () => {
      logger.info('spoof_attempt', { ...SPOOF, benign: 'ok' })
    })
    const entry = parse(captured[0].line)
    // context wins
    expect(entry.requestId).toBe('real-req-0001')
    expect(entry.userId).toBe('real-user')
    expect(entry.schoolId).toBe('real-school')
    // the spoofed values never appear anywhere in the line
    const line = captured[0].line
    expect(line).not.toContain('spoofed-request-id')
    expect(line).not.toContain('spoofed-user')
    expect(line).not.toContain('spoofed-school')
    expect(line).not.toContain('spoofed/route')
    // unrelated fields still flow
    expect(entry.benign).toBe('ok')
  })

  test('spoofed context fields are dropped even OUTSIDE a scope (never emitted)', () => {
    logger.info('spoof_no_ctx', { ...SPOOF })
    const entry = parse(captured[0].line)
    expect(entry.requestId).toBeUndefined()
    expect(entry.userId).toBeUndefined()
    expect(entry.schoolId).toBeUndefined()
    expect(entry.route).toBeUndefined()
    expect(entry.operation).toBeUndefined()
  })
})

// ── 5. redaction through the logger ─────────────────────────────────────

describe('logger · redaction of sensitive fields', () => {
  test('top-level sensitive keys are [REDACTED]', () => {
    logger.info('secret_probe', { password: 'hunter2', token: 'abc', note: 'visible' })
    const entry = parse(captured[0].line)
    expect(entry.password).toBe('[REDACTED]')
    expect(entry.token).toBe('[REDACTED]')
    expect(entry.note).toBe('visible')
    expect(captured[0].line).not.toContain('hunter2')
    expect(captured[0].line).not.toContain('abc')
  })

  test('nested sensitive keys are [REDACTED] too', () => {
    logger.info('nested_probe', { request: { headers: { authorization: 'Bearer xyz' } }, ok: true })
    const entry = parse(captured[0].line) as { request: { headers: Record<string, unknown> } }
    expect(entry.request.headers.authorization).toBe('[REDACTED]')
    expect(captured[0].line).not.toContain('Bearer xyz')
  })

  test('over-long strings are truncated before emit', () => {
    logger.info('trunc_probe', { blob: 'z'.repeat(5000) })
    const entry = parse(captured[0].line)
    expect((entry.blob as string).length).toBeLessThanOrEqual(2020) // 2000 + truncation marker
    expect((entry.blob as string).startsWith('z'.repeat(100))).toBe(true)
  })
})

// ── 6. hostile / unserializable field sets ───────────────────────────────

describe('logger · hostile field sets degrade safely (never throw)', () => {
  test('a fields object with a throwing getter logs a marker line instead of throwing', () => {
    const hostile: Record<string, unknown> = {}
    Object.defineProperty(hostile, 'boom', {
      enumerable: true,
      get() { throw new Error('getter explosion') },
    })
    let threw = false
    try {
      logger.info('hostile_fields', hostile)
    } catch {
      threw = true
    }
    // THE invariant: logging must never become a failure mode.
    expect(threw).toBe(false)
    expect(captured.length).toBe(1)
    const entry = parse(captured[0].line)
    expect(entry.event).toBe('hostile_fields')
    expect(entry.level).toBe('info')
    expect(entry.detail).toBe('[unserializable-fields]')
  })

  test('circular structures are depth-capped, not a crash', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    let threw = false
    try {
      logger.info('circular_fields', { deep: circular })
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(captured.length).toBe(1)
    const entry = parse(captured[0].line) as { deep: { self: { self: { self: { self: unknown } } } } }
    expect(entry.deep.a).toBe(1)
    expect(entry.deep.self.self.self.self).toBe('[max-depth]')
  })

  test('BigInt / Symbol / Map values serialize to safe strings/objects', () => {
    logger.info('exotic', { count: 10n, flag: Symbol('x'), m: new Map([['k', 'v']]) })
    const entry = parse(captured[0].line)
    expect(entry.count).toBe('10') // BigInt → string
    expect(typeof entry.flag).toBe('string')
    expect(entry.m).toEqual({}) // exotic container → safe empty object
  })
})
