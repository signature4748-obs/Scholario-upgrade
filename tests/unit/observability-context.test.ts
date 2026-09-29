/**
 * PHASE 4 (item 10) — UNIT tests: the AsyncLocalStorage request context.
 *
 * Pure-function scope: NO database, NO HTTP.
 *
 * Contract under test (src/lib/observability/context.ts):
 *   · runWithContext(fn) — fn (and everything it awaits) sees the context
 *   · nested scopes are isolated: the inner scope NEVER mutates the outer
 *   · patchRequestContext mutates only the CURRENT store
 *   · patchRequestContext outside a scope is a safe no-op
 *   · runInTestContext defaults the requestId
 */
import { describe, test, expect } from 'bun:test'
import {
  runWithContext,
  runInTestContext,
  getRequestContext,
  patchRequestContext,
} from '@/lib/observability/context'

describe('runWithContext · scope lifecycle', () => {
  test('the context is visible inside the scope and returns fn\'s value', () => {
    const out = runWithContext({ requestId: 'ctx-0001', route: '/api/x' }, () => {
      expect(getRequestContext()?.requestId).toBe('ctx-0001')
      expect(getRequestContext()?.route).toBe('/api/x')
      return 'returned-value'
    })
    expect(out).toBe('returned-value')
  })

  test('outside any scope getRequestContext() is undefined', () => {
    expect(getRequestContext()).toBeUndefined()
  })

  test('the context is absent again after the scope ends', () => {
    runWithContext({ requestId: 'ctx-0002' }, () => undefined)
    expect(getRequestContext()).toBeUndefined()
  })

  test('async work keeps the context across awaits (async-chain propagation)', async () => {
    await runWithContext({ requestId: 'ctx-async-1' }, async () => {
      const afterTick = await new Promise((r) => setTimeout(r, 5))
      expect(afterTick).toBeUndefined()
      expect(getRequestContext()?.requestId).toBe('ctx-async-1')
      const inner = await Promise.resolve().then(() => getRequestContext())
      expect(inner?.requestId).toBe('ctx-async-1')
    })
  })
})

describe('runWithContext · nested scope isolation', () => {
  test('an inner scope sees its own context, not the outer one', () => {
    runWithContext({ requestId: 'outer-0001', userId: 'outer-user' }, () => {
      runWithContext({ requestId: 'inner-0001' }, () => {
        const ctx = getRequestContext()
        expect(ctx?.requestId).toBe('inner-0001')
        expect(ctx?.userId).toBeUndefined() // the inner scope REPLACES, not merges
      })
      // back in the outer scope — untouched
      expect(getRequestContext()?.requestId).toBe('outer-0001')
      expect(getRequestContext()?.userId).toBe('outer-user')
    })
  })

  test('nested async scopes stay isolated under interleaving', async () => {
    await runWithContext({ requestId: 'a-outer' }, async () => {
      const innerPromise = runWithContext({ requestId: 'a-inner' }, async () => {
        await new Promise((r) => setTimeout(r, 3))
        return getRequestContext()?.requestId
      })
      await new Promise((r) => setTimeout(r, 1))
      const outerHere = getRequestContext()?.requestId
      const innerResult = await innerPromise
      expect(innerResult).toBe('a-inner')
      expect(outerHere).toBe('a-outer')
    })
  })
})

describe('patchRequestContext · current-store mutation', () => {
  test('patches only the current store (post-auth enrichment pattern)', () => {
    runWithContext({ requestId: 'patch-0001' }, () => {
      patchRequestContext({ userId: 'user-42', schoolId: 'school-42' })
      const ctx = getRequestContext()
      expect(ctx?.userId).toBe('user-42')
      expect(ctx?.schoolId).toBe('school-42')
      expect(ctx?.requestId).toBe('patch-0001') // unchanged
    })
  })

  test('a nested patch never bleeds into the outer scope', () => {
    runWithContext({ requestId: 'outer-patch', userId: 'outer-user' }, () => {
      runWithContext({ requestId: 'inner-patch' }, () => {
        patchRequestContext({ userId: 'inner-user' })
        expect(getRequestContext()?.userId).toBe('inner-user')
      })
      expect(getRequestContext()?.userId).toBe('outer-user')
    })
  })

  test('patching with undefined values leaves existing values alone', () => {
    runWithContext({ requestId: 'keep-0001', userId: 'kept-user' }, () => {
      patchRequestContext({ userId: undefined, schoolId: 'new-school' })
      const ctx = getRequestContext()
      expect(ctx?.userId).toBe('kept-user')
      expect(ctx?.schoolId).toBe('new-school')
    })
  })

  test('patch outside any scope is a no-op (never throws)', () => {
    expect(() => patchRequestContext({ userId: 'orphan' })).not.toThrow()
    expect(getRequestContext()).toBeUndefined()
  })
})

describe('runInTestContext · test helper', () => {
  test('supplies a default requestId when none is given', () => {
    runInTestContext({}, () => {
      expect(getRequestContext()?.requestId).toBe('test-request')
    })
  })

  test('an explicit context wins over the default', () => {
    runInTestContext({ requestId: 'my-test-id', schoolId: 'sch-1' }, () => {
      const ctx = getRequestContext()
      expect(ctx?.requestId).toBe('my-test-id')
      expect(ctx?.schoolId).toBe('sch-1')
    })
  })

  test('returns fn\'s value and supports async fns', async () => {
    const out = await runInTestContext({ requestId: 'async-test' }, async () => {
      await Promise.resolve()
      return getRequestContext()?.requestId
    })
    expect(out).toBe('async-test')
  })
})
