/**
 * SVIX SIGNATURE VERIFICATION — pure dual-scheme tests (no DB, no fetch).
 *
 * The two HMAC key derivations (src/lib/email/svix-signature.ts):
 *
 *   Scheme A (legacy, string-key)     key = UTF-8 bytes of the FULL secret
 *     — how Scholario's route verified the provider's events live on
 *     2026-10-11/12 (2 signature-verified email.delivered rows).
 *
 *   Scheme B (current provider stack)  key = base64-decoded secret minus
 *     the whsec_ prefix — EXACTLY what `standardwebhooks` does, the
 *     library the provider's own SDK delegates to (svix →
 *     standardwebhooks), hence the derivation the provider's CURRENT
 *     dispatcher signs with (live evidence 2026-10-22: real Svix
 *     dispatches, 3× backoff retries, recorded in the rejection-evidence
 *     ledger, ALL failing Scheme A against the whsec_… secret synced
 *     verbatim from the provider's own create-webhook response).
 *
 * Both schemes must verify; every fail-closed path must refuse with the
 * honest reason; a forged signature must fail BOTH schemes.
 */
import { describe, test, expect } from 'bun:test'
import { createHmac } from 'crypto'

import { svixHmacKeys, verifySvixEnvelope, SVIX_TIMESTAMP_TOLERANCE_MS } from '@/lib/email/svix-signature'

const NOW = 1764000000_000 // fixed clock for determinism
const NOW_S = Math.floor(NOW / 1000)

/** Sign `${id}.${ts}.${raw}` with an arbitrary key buffer (either scheme). */
function signWith(key: Buffer | string, id: string, ts: string | number, raw: string): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')}`
}

/** A standard whsec_-shaped secret: prefix + base64 of raw key material. */
const RAW_KEY_MATERIAL = 'a-test-signing-secret-with-plenty-of-entropy!'
const WHSEC_SECRET = `whsec_${Buffer.from(RAW_KEY_MATERIAL).toString('base64')}`

function envelope(input: Partial<Parameters<typeof verifySvixEnvelope>[0]> = {}) {
  return {
    secret: WHSEC_SECRET,
    rawBody: '{"type":"email.delivered","data":{"id":"m1"}}',
    id: 'msg_test_1',
    timestamp: String(NOW_S),
    signatureHeader: null as string | null,
    now: NOW,
    ...input,
  }
}

describe('svixHmacKeys — the two derivations', () => {
  test('a non-prefixed secret yields exactly ONE key: its raw string bytes (legacy shape)', () => {
    const keys = svixHmacKeys('raw-legacy-secret-38-chars-of-test-material')
    expect(keys.length).toBe(1)
    expect(keys[0].equals(Buffer.from('raw-legacy-secret-38-chars-of-test-material', 'utf8'))).toBe(true)
  })

  test('a whsec_ secret yields TWO keys: full-string AND base64-decoded tail (standardwebhooks)', () => {
    const keys = svixHmacKeys(WHSEC_SECRET)
    expect(keys.length).toBe(2)
    expect(keys[0].equals(Buffer.from(WHSEC_SECRET, 'utf8'))).toBe(true)
    expect(keys[1].equals(Buffer.from(RAW_KEY_MATERIAL, 'utf8'))).toBe(true)
  })

  test('a whsec_ prefix with an undecodable tail degrades to the single raw key (never crashes, never empty-key accepts)', () => {
    const keys = svixHmacKeys('whsec_@@@@')
    expect(keys.length).toBe(1)
  })

  test('whsec_ alone (no tail) degrades to the single raw key', () => {
    expect(svixHmacKeys('whsec_').length).toBe(1)
  })
})

describe('verifySvixEnvelope — scheme A (legacy full-string key) still verifies', () => {
  test('whsec_ secret: signature computed with the FULL string key is accepted (Oct 11-12 semantics)', () => {
    const raw = '{"type":"email.delivered","data":{"id":"m1"}}'
    const id = 'msg_legacy_1'
    const sig = signWith(WHSEC_SECRET, id, NOW_S, raw) // key = full string bytes
    const v = verifySvixEnvelope(envelope({ rawBody: raw, id, signatureHeader: sig }))
    expect(v.ok).toBe(true)
  })

  test('non-prefixed secret: raw-string-key signature is accepted (single-scheme)', () => {
    const secret = 'raw-legacy-secret-38-chars-of-test-material'
    const raw = '{"type":"email.sent"}'
    const id = 'msg_legacy_2'
    const sig = signWith(secret, id, NOW_S, raw)
    const v = verifySvixEnvelope(envelope({ secret, rawBody: raw, id, signatureHeader: sig }))
    expect(v.ok).toBe(true)
  })
})

describe('verifySvixEnvelope — scheme B (standardwebhooks derivation) verifies', () => {
  test('whsec_ secret: signature computed with the DECODED tail key is accepted (the current provider stack)', () => {
    const raw = '{"type":"email.delivered","data":{"id":"m2"}}'
    const id = 'msg_current_1'
    const decodedKey = Buffer.from(WHSEC_SECRET.slice('whsec_'.length), 'base64')
    const sig = signWith(decodedKey, id, NOW_S, raw)
    const v = verifySvixEnvelope(envelope({ rawBody: raw, id, signatureHeader: sig }))
    expect(v.ok).toBe(true)
  })

  test('both schemes may appear as separate v1 tokens in ONE header — any match accepts', () => {
    const raw = '{"type":"email.delivered","data":{"id":"m3"}}'
    const id = 'msg_multi_1'
    const sigA = signWith(WHSEC_SECRET, id, NOW_S, raw)
    const decodedKey = Buffer.from(WHSEC_SECRET.slice('whsec_'.length), 'base64')
    const sigB = signWith(decodedKey, id, NOW_S, raw)
    const v = verifySvixEnvelope(envelope({ rawBody: raw, id, signatureHeader: `v1gpg,deadbeef ${sigA} ${sigB}` }))
    expect(v.ok).toBe(true)
  })
})

describe('verifySvixEnvelope — fail-closed paths keep the honest reasons', () => {
  const raw = '{"type":"email.delivered"}'
  const id = 'msg_fc_1'

  test('no secret configured → refuse', () => {
    const v = verifySvixEnvelope(envelope({ secret: '', signatureHeader: 'v1,AAAA' }))
    expect(v).toEqual({ ok: false, reason: 'no signing secret configured' })
  })

  test('missing svix headers → refuse', () => {
    const v = verifySvixEnvelope(envelope({ signatureHeader: null }))
    expect(v).toEqual({ ok: false, reason: 'missing svix headers' })
  })

  test('malformed timestamp → refuse', () => {
    const v = verifySvixEnvelope(envelope({ timestamp: 'not-a-number', signatureHeader: 'v1,AAAA' }))
    expect(v).toEqual({ ok: false, reason: 'malformed timestamp' })
  })

  test('stale timestamp (outside the replay window) → refuse', () => {
    const oldTs = NOW_S - Math.floor(SVIX_TIMESTAMP_TOLERANCE_MS / 1000) - 60
    const sig = signWith(WHSEC_SECRET, id, oldTs, raw)
    const v = verifySvixEnvelope(envelope({ rawBody: raw, id, timestamp: String(oldTs), signatureHeader: sig }))
    expect(v).toEqual({ ok: false, reason: 'stale timestamp (replay)' })
  })

  test('no v1 token in the header → refuse', () => {
    const v = verifySvixEnvelope(envelope({ rawBody: raw, id, signatureHeader: 'v1gpg,only-gpg' }))
    expect(v).toEqual({ ok: false, reason: 'no v1 signature token' })
  })

  test('a FORGED signature fails BOTH schemes → signature mismatch (the live 2026-10-22 ledger reason)', () => {
    const v = verifySvixEnvelope(envelope({ rawBody: raw, id, signatureHeader: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }))
    expect(v).toEqual({ ok: false, reason: 'signature mismatch' })
  })

  test('a signature valid under scheme A but a body tampered after signing → mismatch', () => {
    const sig = signWith(WHSEC_SECRET, id, NOW_S, raw)
    const v = verifySvixEnvelope(envelope({ rawBody: raw + ' ', id, signatureHeader: sig }))
    expect(v).toEqual({ ok: false, reason: 'signature mismatch' })
  })

  test('the secret is whitespace-trimmed before use (deployment ergonomics)', () => {
    const sig = signWith(WHSEC_SECRET, id, NOW_S, raw)
    const v = verifySvixEnvelope(envelope({ secret: `  ${WHSEC_SECRET}  \n`, rawBody: raw, id, signatureHeader: sig }))
    expect(v.ok).toBe(true)
  })
})
