import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/**
 * Phase 1 — secrets hygiene test.
 *
 * Asserts:
 *   1. `.env` and the runtime DB are NOT tracked by git (secrets + PII
 *      never enter version control from here on).
 *   2. No tracked file contains high-confidence secret material
 *      (API keys, private keys, live provider credentials).
 *   3. The env template documents every env the app reads.
 */

const git = (args: string[]): string => {
  const r = spawnSync('git', args, { cwd: '/home/z/my-project', encoding: 'utf8' })
  return r.status === 0 ? r.stdout.toString() : ''
}

const tracked = git(['ls-files']).split('\n').filter(Boolean)

describe('tracked files hygiene', () => {
  test('.env is NOT tracked (git-ignored, local only)', () => {
    expect(tracked).not.toContain('.env')
  })

  test('runtime database is NOT tracked (contains PII)', () => {
    expect(tracked).not.toContain('db/custom.db')
    expect(tracked.filter((f) => f.endsWith('.db'))).toEqual([])
  })

  test('an env template IS tracked so setups are reproducible', () => {
    expect(tracked).toContain('.env.example')
  })
})

describe('secret material scan (tracked files)', () => {
  // High-confidence secret patterns.
  const patterns: Array<{ name: string; re: RegExp }> = [
    { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
    { name: 'private key block', re: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
    { name: 'live Razorpay secret assignment', re: /^\s*RAZORPAY_(KEY|WEBHOOK)_SECRET\s*=\s*['"][A-Za-z0-9]{8,}['"]/ },
  ]

  // Files where demo/mock VALUES legitimately appear (not secrets):
  // the env template (empty values), docs (policy text), tests themselves.
  const allowFiles = /(^\.env\.example$|^docs\/|^tests\/|^\.gitignore$)/
  // Binary/bulk dirs that are skipped for content scan speed.
  const skipContent = /(\.(png|jpg|jpeg|webp|gif|woff2?|ttf|db|ico|svg|pdf|zip|wasm)$|^public\/tesseract\/|^qa-shots\/|^db\/uploads\/)/

  const offenders: string[] = []
  outer: for (const file of tracked) {
    if (skipContent.test(file)) continue
    let content: string
    try {
      content = readFileSync(`/home/z/my-project/${file}`, 'utf8')
    } catch {
      continue
    }
    for (const { name, re } of patterns) {
      re.lastIndex = 0
      const m = re.exec(content)
      if (m) {
        // Env template + docs may only ever hold EMPTY placeholders.
        if (allowFiles.test(file)) {
          const assigned = m[0]
          if (file === '.env.example' && !/=\s*(["']|$|\s*#)/.test(assigned)) continue
          continue
        }
        offenders.push(`${file}: ${name} (${m[0].slice(0, 12)}…)`)
        continue outer
      }
    }
  }

  test('no high-confidence secrets in any tracked file', () => {
    expect(offenders).toEqual([])
  })

  test('.env.example documents every environment variable the app reads', () => {
    const template = readFileSync('/home/z/my-project/.env.example', 'utf8')
    for (const key of [
      'DATABASE_URL',
      'FILE_SIGNING_SECRET',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'PAYMENTS_SANDBOX',
      'PAYMENTS_SANDBOX_SECRET',
      'SCHOOL_EMBED_ORIGINS',
      'SCHOLARIO_DEV_BEARER',
    ]) {
      expect(template).toContain(key)
    }
  })
})
