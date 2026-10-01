import { db } from '../helpers/db'
/**
 * PHASE 2 — unit tests for the central authorization model
 * (src/lib/security/authz.ts + permissions.ts).
 *
 * Covers the pipeline stages that can be exercised without HTTP:
 *   · permission matrix fail-closed semantics
 *   · authorize(): identity/tenant/role/permission resolution
 *   · resource-scope guards: assertTenantRow / assertSameTenant /
 *     assertStudentInTenant (against the real DB tenants)
 *   · client-supplied schoolId stripping
 */
import { describe, test, expect } from 'bun:test'

import { can, rolesWith } from '@/lib/security/permissions'
import { authorize, assertTenantRow, assertSameTenant, assertStudentInTenant, stripClientSchoolId, type Authz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import type { AuthUser } from '@/lib/auth'


function fakeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u-test',
    email: 'test@school.test',
    name: 'Test',
    role: 'PRINCIPAL',
    schoolId: 'school-x',
    avatarUrl: null,
    phone: null,
    status: 'ACTIVE',
    school: null,
    ...overrides,
  }
}

const ctxA: Authz = {
  user: fakeUser(),
  role: 'PRINCIPAL',
  schoolId: 'school-A',
  isPlatform: false,
  tenant: { schoolId: 'school-A' },
}

// ── permission matrix ───────────────────────────────────────────────────

describe('permissions matrix (server-side source of truth)', () => {
  test('known capabilities resolve for the right roles', () => {
    expect(can('PRINCIPAL', 'school.finance.read')).toBe(true)
    expect(can('ACCOUNTANT', 'school.finance.read')).toBe(true)
    expect(can('TEACHER', 'school.finance.read')).toBe(false)
    expect(can('STUDENT', 'school.students.read')).toBe(false)
    expect(can('TEACHER', 'school.homework.read')).toBe(true)
  })

  test('UNKNOWN permissions fail CLOSED (typo never opens a door)', () => {
    expect(can('PRINCIPAL', 'school.finance.reddd')).toBe(false)
    expect(can('SUPER_ADMIN', 'nonexistent.permission')).toBe(false)
    expect(rolesWith('nonexistent.permission')).toEqual([])
  })

  test('platform capability is exclusive to SUPER_ADMIN', () => {
    expect(can('SUPER_ADMIN', 'platform.admin')).toBe(true)
    expect(can('PRINCIPAL', 'platform.admin')).toBe(false)
  })
})

// ── authorize() pipeline ────────────────────────────────────────────────

describe('authorize(): Request → identity → tenant → role → permission', () => {
  test('rejects unauthenticated identities', async () => {
    await expect(authorize(null)).rejects.toThrow(AppError)
    // Phase 4 canonical taxonomy: 401s are AUTH_REQUIRED (UNAUTHORIZED is
    // the deprecated alias kept in the union).
    await expect(authorize(null)).rejects.toThrow('AUTH_REQUIRED')
  })

  test('rejects non-ACTIVE identities (suspended accounts)', async () => {
    await expect(authorize(fakeUser({ status: 'SUSPENDED' }))).rejects.toThrow(AppError)
  })

  test('school-scoped policies refuse SUPER_ADMIN (platform has no tenant)', async () => {
    await expect(authorize(fakeUser({ role: 'SUPER_ADMIN', schoolId: null }))).rejects.toThrow(AppError)
    try {
      await authorize(fakeUser({ role: 'SUPER_ADMIN', schoolId: 'school-A' }))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).status).toBe(403)
    }
  })

  test('school-scoped policies refuse schoolless identities', async () => {
    await expect(authorize(fakeUser({ schoolId: null }))).rejects.toThrow(AppError)
  })

  test('resolves the tenant FROM THE IDENTITY (never client input)', async () => {
    const ctx = await authorize(fakeUser({ schoolId: 'school-A' }))
    expect(ctx.schoolId).toBe('school-A')
    expect(ctx.tenant).toEqual({ schoolId: 'school-A' })
    expect(ctx.isPlatform).toBe(false)
  })

  test('role gate rejects out-of-policy roles', async () => {
    await expect(
      authorize(fakeUser({ role: 'STUDENT' }), { roles: ['PRINCIPAL', 'MANAGEMENT'] }),
    ).rejects.toThrow(AppError)
  })

  test('permission gate uses the matrix', async () => {
    await expect(
      authorize(fakeUser({ role: 'STUDENT' }), { permission: 'school.finance.read' }),
    ).rejects.toThrow(AppError)
    const ctx = await authorize(fakeUser({ role: 'ACCOUNTANT' }), { permission: 'school.finance.read' })
    expect(ctx.role).toBe('ACCOUNTANT')
  })

  test("tenant:'any' admits platform and schoolless identities", async () => {
    const ctx = await authorize(fakeUser({ role: 'SUPER_ADMIN', schoolId: null }), { tenant: 'any' })
    expect(ctx.isPlatform).toBe(true)
    expect(ctx.schoolId).toBe('')
  })

  test('both role AND permission gates must pass when both are given', async () => {
    // TEACHER holds 'school.homework.read' but not the explicit role list.
    await expect(
      authorize(fakeUser({ role: 'TEACHER' }), { roles: ['PRINCIPAL'], permission: 'school.homework.read' }),
    ).rejects.toThrow(AppError)
  })
})

// ── resource-scope guards ───────────────────────────────────────────────

describe('resource-scope guards (fail-safe 404 semantics)', () => {
  test('assertTenantRow returns the row for a matching tenant', () => {
    const row = { id: 'r1', schoolId: 'school-A', name: 'thing' }
    expect(assertTenantRow(row, ctxA, 'Thing')).toBe(row)
  })

  test('assertTenantRow 404s on foreign tenant and on null (no oracle)', () => {
    for (const bad of [null, { id: 'r2', schoolId: 'school-B', name: 'x' }]) {
      try {
        assertTenantRow(bad as { id: string; schoolId: string } | null, ctxA, 'Thing')
        throw new Error('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(AppError)
        const err = e as AppError
        expect(err.status).toBe(404)
        expect(err.publicMessage).toBe('Thing not found')
        // The internal detail never reaches the client envelope.
        expect(err.internalDetail).toContain('foreign tenant')
      }
    }
  })

  test('assertSameTenant: mismatch → 404, match → silent', () => {
    expect(() => assertSameTenant(ctxA, 'school-A')).not.toThrow()
    expect(() => assertSameTenant(ctxA, 'school-B')).toThrow(AppError)
    expect(() => assertSameTenant(ctxA, null)).toThrow(AppError)
  })
})

describe('assertStudentInTenant (DB-backed, real tenants)', () => {
  test('resolves a student of the caller school', async () => {
    // Phase 8A re-target: the legacy Bluebell fixture student no longer
    // exists (the clean tenant carries ZERO students) — the same-tenant
    // positive resolution is proven against the DEMO tenant's student.
    const schoolA = await db.school.findUnique({ where: { slug: 'sunrise-academy' } })
    const studentA = await db.student.findFirst({ where: { schoolId: schoolA!.id } })
    if (!schoolA || !studentA) throw new Error('run bun prisma/seed-tenant-isolation.ts first')
    const ctxSchoolA: Authz = { ...ctxA, schoolId: schoolA.id, tenant: { schoolId: schoolA.id } }
    const resolved = await assertStudentInTenant(ctxSchoolA, studentA.id)
    expect(resolved.id).toBe(studentA.id)
  })

  test('foreign-school student id → NOT_FOUND (no existence oracle)', async () => {
    const schoolA = await db.school.findUnique({ where: { slug: 'sunrise-academy' } })
    const schoolB = await db.school.findUnique({ where: { slug: 'green-valley' } })
    const studentA = await db.student.findFirst({ where: { schoolId: schoolA!.id } })
    if (!schoolA || !schoolB || !studentA) throw new Error('fixtures missing')
    const ctxB: Authz = { ...ctxA, schoolId: schoolB.id, tenant: { schoolId: schoolB.id } }
    try {
      await assertStudentInTenant(ctxB, studentA.id)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).status).toBe(404)
      expect((e as AppError).publicMessage).toBe('Student not found')
    }
  })
})

// ── client-supplied schoolId defense ────────────────────────────────────

describe('client-supplied schoolId is never trusted', () => {
  test('stripClientSchoolId removes the spoofed field', () => {
    const body = { title: 'x', schoolId: 'school-A', nested: 1 } as Record<string, unknown>
    const clean = stripClientSchoolId(body)
    expect('schoolId' in clean).toBe(false)
    expect(clean.title).toBe('x')
    expect(clean.nested).toBe(1)
  })

  test('stripClientSchoolId is a no-op without the field', () => {
    const body = { title: 'x' } as Record<string, unknown>
    expect(stripClientSchoolId(body)).toEqual({ title: 'x' })
  })
})
