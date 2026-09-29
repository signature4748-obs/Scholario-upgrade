/**
 * account-provisioning — password policy for server-provisioned accounts
 * (students, teachers, school principals created through the admin APIs).
 *
 * Task 4-d (audit 3-a fix #3 / #13): the old create flows defaulted every
 * new account to the shared literal 'password123' — a credential-stuffing
 * gift. This module centralizes the replacement policy:
 *
 *   1. If the caller SUPPLIED a password, it must satisfy the Phase-1
 *      password policy (newPasswordSchema: 8–128 chars, letter + digit).
 *   2. Otherwise a RANDOM 12-character alphanumeric password is generated
 *      (crypto randomBytes, rejection-sampled; no ambiguous glyphs) and
 *      returned with generated=true so the route can surface it ONCE as
 *      `tempPassword` in the create response (additive field — the
 *      operator hands it to the user, who changes it at first login).
 *   3. DEV CONVENIENCE EXCEPTION: when SCHOLARIO_DEFAULT_PASSWORD is set
 *      AND NODE_ENV !== 'production', that value is used instead of a
 *      random one. This exists so local/QA environments can keep scripted
 *      logins working WITHOUT baking a shared production password into
 *      the codebase. It is ignored in production, always.
 */
import { randomBytes } from 'crypto'
import { AppError } from '@/lib/security/errors'
import { newPasswordSchema } from '@/lib/security/validation'

/** Length of generated temporary passwords. */
const TEMP_PASSWORD_LENGTH = 12

/**
 * Alphabet for generated passwords: alphanumeric without visually
 * ambiguous glyphs (no 0/O/1/I/l) so a hand-copied temp password is hard
 * to mistype.
 */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

const DIGITS = '23456789'
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'

/** Random integer in [0, max) from a crypto byte (rejection-sampled). */
function randomIndex(max: number): number {
  const limit = Math.floor(256 / max) * max
  for (;;) {
    const b = randomBytes(1)[0]
    if (b < limit) return b % max
  }
}

/**
 * Generate a random password that SATISFIES newPasswordSchema by
 * construction: one letter + one digit are seeded, the rest is drawn from
 * the full alphabet, then the characters are shuffled (Fisher-Yates with
 * crypto randomness) so the seeded positions are not predictable.
 */
export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  const chars: string[] = [
    LETTERS[randomIndex(LETTERS.length)],
    DIGITS[randomIndex(DIGITS.length)],
  ]
  while (chars.length < length) {
    chars.push(TEMP_PASSWORD_ALPHABET[randomIndex(TEMP_PASSWORD_ALPHABET.length)])
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export interface ProvisionedPassword {
  /** The password to hash into the new account. */
  password: string
  /**
   * True when the value was generated server-side. The route should
   * include `tempPassword` in the response ONLY in this case — a
   * caller-supplied password is already known to the caller, and an
   * env-provided dev default is known to the operator.
   */
  generated: boolean
}

/**
 * Resolve the password for a server-provisioned account from the request
 * body value. Throws AppError('INVALID_INPUT') for supplied passwords that
 * violate the Phase-1 policy; never returns an empty string.
 */
export function resolveProvisionedPassword(clientPassword: unknown): ProvisionedPassword {
  const provided = typeof clientPassword === 'string' ? clientPassword.trim() : ''
  if (provided) {
    const parsed = newPasswordSchema.safeParse(provided)
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Password must be 8–128 characters and contain at least one letter and one number',
        internalDetail: `resolveProvisionedPassword: policy violation (${parsed.error.issues.map((i) => i.message).join('; ')})`,
      })
    }
    return { password: provided, generated: false }
  }

  // DEV CONVENIENCE ONLY — see module docstring. Never active when
  // NODE_ENV === 'production'.
  const envDefault = process.env.SCHOLARIO_DEFAULT_PASSWORD
  if (envDefault && process.env.NODE_ENV !== 'production') {
    return { password: envDefault, generated: false }
  }

  return { password: generateTempPassword(), generated: true }
}
