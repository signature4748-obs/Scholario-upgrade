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

  test('connect-src stays strict in production (no localhost ports, no ws)', () => {
    const csp = prod['Content-Security-Policy']
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? ''
    expect(connect.trim()).toBe("'self'")
    expect(connect).not.toContain('localhost')
    expect(connect).not.toContain('ws:')
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
