/**
 * Central security headers (Phase 1 — item 4).
 *
 * Applied via `next.config.ts` → `headers()` for every route.
 *
 * Dev vs production profiles:
 *   - The sandbox preview renders the app in a CROSS-SITE iframe, so the
 *     DEV profile's `frame-ancestors` allows the sandbox preview origins
 *     (`*.space-z.ai`, `*.z.ai`, `*.chatglm.cn`) — required preview
 *     functionality.
 *   - The PRODUCTION profile restricts `frame-ancestors` to 'self' plus
 *     SCHOOL_EMBED_ORIGINS (comma-separated https origins) — legitimate
 *     school-website embedding stays possible by configuration; random
 *     sites cannot frame the ERP. HSTS is production-only (meaningless
 *     over plain http, and the dev preview is http).
 *
 * CSP notes:
 *   - 'unsafe-inline' on script-src: Next.js App Router hydration uses
 *     inline bootstrap scripts; a nonce-based CSP requires middleware
 *     on every response (deferred deliberately — see baseline doc).
 *   - 'wasm-unsafe-eval' + blob: workers: tesseract.js (client OCR for
 *     marks scan) loads same-origin WASM and blob workers.
 *   - frame-src allows the Razorpay checkout frame (payments page).
 *   - dev adds 'unsafe-eval' (React refresh / dev tooling).
 */
export const PREVIEW_EMBED_ORIGINS = [
  'https://*.space-z.ai',
  'https://*.z.ai',
  'https://*.chatglm.cn',
] as const

function frameAncestors(isProd: boolean, extraEmbedOrigins: string): string[] {
  const list = ["'self'"]
  if (extraEmbedOrigins) {
    for (const raw of extraEmbedOrigins.split(',')) {
      const o = raw.trim()
      if (o && /^https:\/\/[a-z0-9*.-]+(:\d+)?$/i.test(o) && !list.includes(o)) list.push(o)
    }
  }
  if (!isProd) list.push(...PREVIEW_EMBED_ORIGINS, 'http://localhost:*', 'http://127.0.0.1:*')
  return list
}

export interface CspDirectives {
  frameAncestors: string[]
  isProd: boolean
}

/** Build the CSP header value for the given environment profile. */
export function buildCsp(opts: { isProd: boolean; embedOrigins?: string }): string {
  const { isProd } = opts
  const fa = frameAncestors(isProd, opts.embedOrigins ?? process.env.SCHOOL_EMBED_ORIGINS ?? '')

  const scriptSrc = isProd
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"
    : "'self' 'unsafe-inline' 'unsafe-eval' blob:"
  // Dev ONLY: the custom lazy-compilation backend (src/lazy-compilation,
  // fixed port 3777) talks to the browser over an EventSource from a
  // localhost port — 'self' (port 3000) does not cover it. Production
  // builds never lazy-compile, so the prod CSP stays strict.
  const connectSrc = isProd
    ? "'self'"
    : "'self' ws: wss: http://localhost:* http://127.0.0.1:*"

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.unsplash.com https://picsum.photos https://*.razorpay.com",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${fa.join(' ')}`,
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

/** Headers common to dev and production. */
export const BASE_SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
]

/**
 * Full header set for a profile. `isProd` selects HSTS + strict CSP.
 * Exported for next.config.ts and the header tests.
 */
export function securityHeadersFor(opts: {
  isProd: boolean
  embedOrigins?: string
}): Array<{ key: string; value: string }> {
  const headers = [...BASE_SECURITY_HEADERS, { key: 'Content-Security-Policy', value: buildCsp(opts) }]
  if (opts.isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    })
  }
  return headers
}

/** Next.js `headers()` entry shape. */
export function nextSecurityHeaderRules(embedOrigins?: string): Array<{
  source: string
  headers: Array<{ key: string; value: string }>
}> {
  const isProd = process.env.NODE_ENV === 'production'
  return [
    {
      source: '/:path*',
      headers: securityHeadersFor({ isProd, embedOrigins }),
    },
  ]
}
