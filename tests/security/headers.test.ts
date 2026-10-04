import { describe, test, expect } from 'bun:test'
import {
  securityHeadersFor,
  buildCsp,
  BASE_SECURITY_HEADERS,
  PREVIEW_EMBED_ORIGINS,
} from '@/lib/security/headers'

const headerMap = (hs: Array<{ key: string; value: string }>) =>
  Object.fromEntries(hs.map((h) => [h.key, h.value]))

describe('security headers — production profile', () => {
  const prod = headerMap(securityHeadersFor({ isProd: true }))

  test('all OWASP-baseline headers present', () => {
    for (const h of BASE_SECURITY_HEADERS) {
      expect(prod).toHaveProperty(h.key)
    }
    expect(prod['X-Content-Type-Options']).toBe('nosniff')
    expect(prod['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(prod['Permissions-Policy']).toContain('camera=()')
    expect(prod['Permissions-Policy']).toContain('microphone=()')
  })

  test('HSTS present in production', () => {
    expect(prod['Strict-Transport-Security']).toContain('max-age=31536000')
  })

  test('CSP: no unsafe-eval, upgrade-insecure-requests, object-src none', () => {
    const csp = prod['Content-Security-Policy']
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  test('connect-src stays strict in production (self + at most the configured Supabase origin; no localhost, no plain ws)', () => {
    const csp = prod['Content-Security-Policy']
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? ''
    const allowed = new Set(["'self'"])
    const supabase = process.env.SUPABASE_URL?.trim()
    if (supabase) {
      const host = /^https?:\/\//.test(supabase) ? new URL(supabase).host : supabase.replace(/\/$/, '')
      allowed.add(`https://${host}`)
      allowed.add(`wss://${host}`) // Supabase realtime (verified wss only)
    }
    for (const token of connect.trim().split(/\s+/)) {
      expect(allowed.has(token)).toBe(true)
    }
    expect(allowed.size).toBeGreaterThan(0)
    expect(connect).not.toContain('localhost')
    expect(connect).not.toContain('ws:') // plain ws: (wss:// is the only allowed scheme)
    expect(connect).not.toContain('*')
  })

  test('frame protection: production defaults to self (+embed origins)', () => {
    const csp = prod['Content-Security-Policy']
    expect(csp).toContain("frame-ancestors 'self'")
    // without configured embed origins, no wildcard frame access
    expect(csp).not.toContain('frame-ancestors *')

    const withEmbed = buildCsp({ isProd: true, embedOrigins: 'https://www.greenwood.edu.in, https://erp.sps.edu' })
    expect(withEmbed).toContain('https://www.greenwood.edu.in')
    expect(withEmbed).toContain('https://erp.sps.edu')
    // junk schemes are not accepted into frame-ancestors
    const junk = buildCsp({ isProd: true, embedOrigins: 'javascript:alert(1), https://ok.edu' })
    expect(junk).not.toContain('javascript:')
  })
})

describe('security headers — dev profile (preview must keep working)', () => {
  const dev = headerMap(securityHeadersFor({ isProd: false }))

  test('HSTS absent over http dev preview', () => {
    expect(dev['Strict-Transport-Security']).toBeUndefined()
  })

  test('CSP allows dev tooling (eval) and tesseract WASM/workers', () => {
    const csp = dev['Content-Security-Policy']
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain('blob:')
    expect(csp).toContain("worker-src 'self' blob:")
  })

  test('dev connect-src allows the localhost lazy-compilation backend (required dev functionality)', () => {
    const csp = dev['Content-Security-Policy']
    expect(csp).toContain('http://localhost:*')
    expect(csp).toContain('http://127.0.0.1:*')
  })

  test('frame-ancestors includes the sandbox preview origins (required preview functionality)', () => {
    const csp = dev['Content-Security-Policy']
    for (const origin of PREVIEW_EMBED_ORIGINS) {
      expect(csp).toContain(origin)
    }
    expect(csp).toContain('http://localhost:*')
  })
})

describe('security headers — production connect-src derives the Supabase realtime origin (Phase 8C-N fix)', () => {
  // The realtime client bridge opens wss://<ref>.supabase.co and realtime-js
  // authorizes channels over https on the same origin. A connect-src of
  // bare 'self' silently killed the bridge in every real browser
  // (stuck RECONNECTING) — regression-pinned here.
  test('with SUPABASE_URL set, prod connect-src allows exactly that origin (https+wss) and nothing else', () => {
    const prev = process.env.SUPABASE_URL
    process.env.SUPABASE_URL = 'https://kbyknezedewvgrnqervj.supabase.co'
    try {
      const csp = buildCsp({ isProd: true })
      const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? ''
      expect(connect).toBe("'self' https://kbyknezedewvgrnqervj.supabase.co wss://kbyknezedewvgrnqervj.supabase.co")
      // Still strict: no localhost, no bare ws:/wss: wildcards, no other hosts
      expect(connect).not.toContain('localhost')
      expect(connect).not.toMatch(/(^|\s)ws:(\s|$)/)
      expect(connect).not.toMatch(/(^|\s)wss:(\s|$)/)
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = prev
    }
  })

  test('trailing-slash SUPABASE_URL normalizes to the same origin', () => {
    const prev = process.env.SUPABASE_URL
    process.env.SUPABASE_URL = 'https://kbyknezedewvgrnqervj.supabase.co/'
    try {
      const csp = buildCsp({ isProd: true })
      expect(csp).toContain('connect-src \'self\' https://kbyknezedewvgrnqervj.supabase.co wss://kbyknezedewvgrnqervj.supabase.co')
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = prev
    }
  })

  test('malformed SUPABASE_URL is ignored — prod CSP stays strict self-only (no injection surface)', () => {
    for (const junk of ['', 'not a url', "javascript:alert(1)", 'https://evil.example.com/path?x=1', "https://host with spaces"]) {
      const prev = process.env.SUPABASE_URL
      process.env.SUPABASE_URL = junk
      try {
        const connect = /connect-src ([^;]+)/.exec(buildCsp({ isProd: true }))?.[1] ?? ''
        expect(connect.trim()).toBe("'self'")
      } finally {
        if (prev === undefined) delete process.env.SUPABASE_URL
        else process.env.SUPABASE_URL = prev
      }
    }
  })

  test('without SUPABASE_URL (local/CI production build) prod CSP stays strict self-only', () => {
    const prev = process.env.SUPABASE_URL
    delete process.env.SUPABASE_URL
    try {
      const connect = /connect-src ([^;]+)/.exec(buildCsp({ isProd: true }))?.[1] ?? ''
      expect(connect.trim()).toBe("'self'")
    } finally {
      if (prev !== undefined) process.env.SUPABASE_URL = prev
    }
  })

  test('dev profile is unaffected by SUPABASE_URL (dev CSP has its own transport set)', () => {
    const prev = process.env.SUPABASE_URL
    process.env.SUPABASE_URL = 'https://kbyknezedewvgrnqervj.supabase.co'
    try {
      const csp = buildCsp({ isProd: false })
      const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? ''
      expect(connect).toContain('http://localhost:*')
      expect(connect).toContain('wss:')
      expect(connect).not.toContain('kbyknezedewvgrnqervj')
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = prev
    }
  })
})
