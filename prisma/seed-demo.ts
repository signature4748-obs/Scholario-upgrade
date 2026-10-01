/**
 * seed-demo — the Phase-8A DEMO-TENANT pipeline orchestrator.
 *
 * Runs the full Sunrise Academy corpus in dependency order, each step a
 * guarded child process with a per-script log line:
 *
 *   1. prisma/seed.ts                  base corpus (scoped hard-wipe + plant)
 *   2. prisma/seed-platform.ts         platform plane (admins, settings)
 *   3. prisma/seed-tenant-isolation.ts tenant fixtures (clean school ensure +
 *                                      Sunrise cross-tenant probes)
 *   4. prisma/seed-teacher-academics   academic config (classes/CSA/timetable/
 *                                      curriculum/PA1) — preserves probe CSA
 *   5. prisma/seed-teacher-hub         parent connect + behavior corpus
 *   6. prisma/seed-student-dashboard   demo student dashboard corpus
 *   7. prisma/seed-study-materials     materials + files — preserves probe
 *                                      material
 *   8. prisma/seed-learning            flashcards/groups/tasks/activities
 *   9. prisma/seed-roster-150          ~150-student roster (fees/payments/
 *                                      ledger parity, attendance, PA1 marks)
 *  10. prisma/seed-website-cms         branding + CMS + gallery
 *  11. prisma/seed-exam-ops            exam schedule/seats/attendance (last)
 *
 * DETERMINISM: re-running this script RESETS the demo tenant to canonical
 * state. The base seed hard-wipes every non-clean-school row (the clean
 * tenant `green-valley` and its users are explicitly preserved), the
 * per-domain seeds then rebuild their slices with their own wipe-or-top-up
 * idempotency. Expect several minutes end-to-end.
 *
 * The clean tenant (Green Valley Public School) is NOT part of this
 * pipeline — plant it once with `bun run seed:clean` (idempotent,
 * skip-if-exists). seed-tenant-isolation re-ensures it as a belt-and-
 * braces step.
 *
 * Run: bun run seed:demo   (package.json script)
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { assertSeedable } from './seed-guard'

const PROJECT_ROOT = path.resolve(__dirname, '..')

const PIPELINE: { script: string; label: string }[] = [
  { script: 'prisma/seed.ts', label: 'base corpus — Sunrise Academy (scoped hard-wipe + plant)' },
  { script: 'prisma/seed-platform.ts', label: 'platform plane — admins, settings, announcement' },
  { script: 'prisma/seed-tenant-isolation.ts', label: 'tenant fixtures — clean school ensure + Sunrise probes' },
  { script: 'prisma/seed-teacher-academics.ts', label: 'academic config — classes, CSA, timetable, curriculum, PA1' },
  { script: 'prisma/seed-teacher-hub.ts', label: 'teacher hub — parent connect + behavior corpus' },
  { script: 'prisma/seed-student-dashboard.ts', label: 'student dashboard — demo student corpus' },
  { script: 'prisma/seed-study-materials.ts', label: 'study materials — rows + real files' },
  { script: 'prisma/seed-learning.ts', label: 'learning — flashcards, groups, tasks, activities' },
  { script: 'prisma/seed-roster-150.ts', label: 'roster 150 — students, fees, payments, ledger parity' },
  { script: 'prisma/seed-website-cms.ts', label: 'website cms — branding, settings, gallery' },
  { script: 'prisma/seed-exam-ops.ts', label: 'exam ops — schedule, seats, invigilation attendance' },
]

function runStep(script: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PROJECT_ROOT, script)
    if (!existsSync(scriptPath)) {
      reject(new Error(`[seed-demo] pipeline script missing: ${script}`))
      return
    }
    console.log(`\n══ seed-demo · ${script} — ${label}`)

    // Environment hygiene: drop a STALE SQLite-era DATABASE_URL (file:…)
    // so the child reads the postgres URL from .env (bun auto-loads it).
    // A deliberately-set postgres:// URL passes through untouched.
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (env.DATABASE_URL && env.DATABASE_URL.startsWith('file:')) {
      console.log('[seed-demo] dropping stale file: DATABASE_URL from the environment (children read .env)')
      delete env.DATABASE_URL
    }

    const child = spawn('bun', [script], {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'inherit' as const,
    })

    child.on('error', (err) => reject(new Error(`[seed-demo] failed to spawn ${script}: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`[seed-demo] ${script} exited with code ${code} — pipeline aborted (demo tenant left mid-reset; re-run to restore canonical state).`))
    })
  })
}

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement). The guard
  // also protects every child script individually.
  assertSeedable('seed-demo')

  const startedAt = Date.now()
  console.log('🌱 seed-demo: running the full demo-tenant pipeline (Sunrise Academy)…')
  console.log('   Deterministic: re-running resets the demo tenant to canonical state.')
  console.log('   The clean tenant (green-valley) is preserved — plant it with `bun run seed:clean`.')

  for (const step of PIPELINE) {
    await runStep(step.script, step.label)
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\n✅ seed-demo complete — ${PIPELINE.length} steps in ${seconds}s.`)
  console.log('   Demo tenant: sunrise-academy (full corpus). Clean tenant: green-valley (untouched).')
  console.log('   Demo & fixture credentials are env-driven (prisma/seed-credentials.ts,')
  console.log('   overridable via SEED_* vars — see .env.example) and are intentionally')
  console.log('   NOT printed: seed output must never disclose credentials.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
