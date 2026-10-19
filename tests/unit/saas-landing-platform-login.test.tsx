/**
 * SAAS LANDING — the operator's Platform-login CTA must survive the
 * two-plane architecture (the 2026-10-19 practical-acceptance
 * regression).
 *
 * The landing (src/components/marketing/saas-landing.tsx) renders at the
 * root when NO tenant resolves — which in production happens ONLY on
 * the SCHOOL plane (scholario-app-virid.vercel.app + school preview
 * URLs). On that plane the relative /platform/login DOES NOT EXIST: the
 * middleware plane gate answers an honest 404 (by design — no console
 * door to phish on). The landing's three "Platform login / Platform
 * sign-in" CTAs pointed there anyway, so the marketing site's primary
 * operator entry was a guaranteed 404 everywhere it rendered in
 * production (verified live on scholario-app-virid.vercel.app).
 *
 * The fix routes those CTAs to the platform DEPLOYMENT's canonical door:
 *   NEXT_PUBLIC_PLATFORM_URL ?? 'https://scholario-platform.vercel.app'
 * (the same URL the release tooling pins — scripts/prod-release/
 * verify-deployment.ts DEFAULT_PLATFORM_URL) + '/platform/login'.
 *
 * This suite pins, via renderToStaticMarkup (no DOM needed — the href
 * is a module-level constant, identical on server and client):
 *
 *   1. every platform-login CTA carries the ABSOLUTE platform URL;
 *   2. no relative href="/platform/login" remains anywhere in the
 *      rendered landing (the broken form is fully gone);
 *   3. the in-page section anchors (#features, #contact, …) and any
 *      tenant-door links are untouched by the change.
 */
import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SaasLanding } from '@/components/marketing/saas-landing'

const CANONICAL_PLATFORM_LOGIN = 'https://scholario-platform.vercel.app/platform/login'

describe('SaaS landing — the operator CTA targets the platform deployment', () => {
  const html = renderToStaticMarkup(React.createElement(SaasLanding, {}))

  test('the canonical platform-login URL appears as the CTA href', () => {
    // At least the header CTA and the footer sign-in (the hero card may
    // conditionally render) — the absolute platform door must be present.
    expect(html).toContain(`href="${CANONICAL_PLATFORM_LOGIN}"`)
  })

  test('NO relative href="/platform/login" remains (the 404-on-school-plane form is gone)', () => {
    expect(html).not.toContain('href="/platform/login"')
  })

  test('the platform CTA hrefs open the control-plane door, not the school plane', () => {
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1])
    const platformCtas = hrefs.filter((h) => h.includes('/platform/login'))
    expect(platformCtas.length).toBeGreaterThanOrEqual(2) // header + footer at minimum
    for (const href of platformCtas) {
      expect(href.startsWith('https://')).toBe(true)
      expect(href).toBe(CANONICAL_PLATFORM_LOGIN)
    }
  })

  test('in-page section anchors are untouched by the change', () => {
    const html2 = html
    for (const anchor of ['#features', '#how-it-works', '#plans', '#for-schools', '#contact']) {
      expect(html2).toContain(`href="${anchor}"`)
    }
  })
})
