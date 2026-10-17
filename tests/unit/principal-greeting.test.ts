/**
 * Regression test — principal dashboard greeting (sprint polish batch A).
 *
 * Defect being locked out: the WelcomeBanner used to split the display
 * name on the first two words, so the seeded principal
 * "Dr. (Smt.) Sunita Verma" was greeted as "Dr. (Smt.)" (an honorific
 * stack, not a name), and the greeting was hardcoded "Good morning"
 * regardless of the device clock.
 *
 * The fix exports `givenName` / `timeGreeting` from the dashboard's
 * shared module; this test pins their contracts:
 *   - Indian honorific prefixes (with dots and parenthesized forms) are
 *     skipped when extracting the given name
 *   - names with no honorific resolve to their first word
 *   - degenerate inputs resolve honestly (null / single honorific)
 *   - the time-of-day bands match the teacher/student dashboards
 */
import { describe, expect, test } from 'bun:test'
import { givenName, timeGreeting } from '@/components/principal/modules/dashboard/shared'

describe('principal dashboard greeting — givenName', () => {
  test('skips the seeded principal honorific stack', () => {
    // The exact seeded principal display name (regression case).
    expect(givenName('Dr. (Smt.) Sunita Verma')).toBe('Sunita')
  })

  test('skips common Indian honorific prefixes', () => {
    expect(givenName('Smt. Kavita Singh')).toBe('Kavita')
    expect(givenName('Shri Ramesh Chandra Yadav')).toBe('Ramesh')
    expect(givenName('Sri Devendra Pratap Singh')).toBe('Devendra')
    expect(givenName('Ms. Anjali Dwivedi')).toBe('Anjali')
    expect(givenName('Prof. Amit Kumar')).toBe('Amit')
  })

  test('plain names resolve to the first word', () => {
    expect(givenName('Zainab Verma')).toBe('Zainab')
    expect(givenName('Aarav Sharma')).toBe('Aarav')
  })

  test('single-word names survive', () => {
    expect(givenName('Sunita')).toBe('Sunita')
  })

  test('degenerate inputs are honest, never a greeting fragment', () => {
    expect(givenName(null)).toBeNull()
    expect(givenName(undefined)).toBeNull()
    expect(givenName('')).toBeNull()
    expect(givenName('   ')).toBeNull()
    // Only an honorific → fall back to the last raw word, never "Dr."
    expect(givenName('Dr.')).toBe('Dr')
  })

  test('collapse of repeated whitespace does not invent tokens', () => {
    expect(givenName('  Dr.   (Smt.)   Sunita   Verma  ')).toBe('Sunita')
  })
})

describe('principal dashboard greeting — timeGreeting', () => {
  test('morning band ends at 12:00', () => {
    expect(timeGreeting(0)).toBe('Good morning')
    expect(timeGreeting(6)).toBe('Good morning')
    expect(timeGreeting(11)).toBe('Good morning')
  })

  test('afternoon band ends at 17:00', () => {
    expect(timeGreeting(12)).toBe('Good afternoon')
    expect(timeGreeting(16)).toBe('Good afternoon')
  })

  test('evening band covers the rest of the day', () => {
    expect(timeGreeting(17)).toBe('Good evening')
    expect(timeGreeting(23)).toBe('Good evening')
  })
})
