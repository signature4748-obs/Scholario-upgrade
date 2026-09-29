import { describe, test, expect } from 'bun:test'
import { AUDIT_ACTIONS, sanitizeAuditDetail, type AuditAction } from '@/lib/security/audit'

describe('audit vocabulary', () => {
  test('covers every Phase-1 mandated security event', () => {
    const required: AuditAction[] = [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'PASSWORD_CHANGED',
      'SESSIONS_REVOKED',
      'SESSION_ROTATED',
      'PERMISSION_CHANGE',
      'STUDENT_DATA_EXPORT',
      'FEE_OPERATION',
      'MARKS_CHANGE',
      'ADMISSION_APPROVED',
      'ACCOUNT_ACTIVATED',
      'PLATFORM_SETTING_CHANGE',
    ]
    for (const action of required) {
      expect(AUDIT_ACTIONS).toContain(action)
    }
  })
})

describe('audit detail sanitization (no secrets into the audit trail)', () => {
  test('redacts 64-hex session tokens', () => {
    const out = sanitizeAuditDetail('signed in with token a'.padEnd(0) + 'abcd'.repeat(16))
    expect(out).not.toMatch(/[a-f0-9]{64}/)
    expect(out).toContain('[redacted-token]')
  })
  test('redacts API keys and password assignments', () => {
    expect(sanitizeAuditDetail('used key sk-abcdefghijklmnop123456')).toContain('[redacted-key]')
    expect(sanitizeAuditDetail('login password=hunter2 ok')).toBe('login password=[redacted] ok')
    expect(sanitizeAuditDetail('Authorization: Bearer abc secret=x')).toContain('[redacted]')
  })
  test('caps detail length (bounded audit rows)', () => {
    expect(sanitizeAuditDetail('x'.repeat(1000)).length).toBeLessThanOrEqual(400)
  })
  test('ordinary detail passes through', () => {
    expect(sanitizeAuditDetail('Password changed; 2 other session(s) revoked')).toBe(
      'Password changed; 2 other session(s) revoked'
    )
  })
})
