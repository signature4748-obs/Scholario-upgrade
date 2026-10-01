-- PHASE 4 — OBSERVABILITY: JobRun tracking + WebhookEvent attempt counts.
--
-- JobRun records every background/deferred job execution: job id, start,
-- finish, duration, success/failure, retry state, error, idempotency key.
-- (jobName, idempotencyKey) UNIQUE — a second delivery of the same key is
-- skipped after a prior success (JobRunner short-circuit).
--
-- WebhookEvent.attempts counts deliveries seen per event id (retries and
-- signed replays) on top of the Phase-3 eventId idempotency gate.
--
-- Prisma's differ does not manage triggers → zero drift risk (same
-- pattern as 20260201010000_db_level_guards). The JobRun tenant guard
-- keeps observability rows tenant-consistent.
--
-- NOTE (SQLite): the school FK is declared INLINE — SQLite has no
-- ALTER TABLE ... ADD CONSTRAINT.

-- ── JobRun ───────────────────────────────────────────────────────────
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "schoolId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'request',
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "error" TEXT,
    "resultSummary" TEXT,
    "requestId" TEXT,
    CONSTRAINT "JobRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE UNIQUE INDEX "JobRun_jobId_key" ON "JobRun"("jobId");
CREATE UNIQUE INDEX "JobRun_jobName_idempotencyKey_key" ON "JobRun"("jobName", "idempotencyKey");
CREATE INDEX "JobRun_jobName_status_startedAt_idx" ON "JobRun"("jobName", "status", "startedAt");
CREATE INDEX "JobRun_schoolId_jobName_startedAt_idx" ON "JobRun"("schoolId", "jobName", "startedAt");

-- ── Tenant guard: JobRun.schoolId must reference a real School ───────
CREATE TRIGGER "tg_guard_JobRun_ins" BEFORE INSERT ON "JobRun"
WHEN
  NEW."schoolId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "School" S WHERE S."id" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: JobRun.schoolId must reference a School'); END;

CREATE TRIGGER "tg_guard_JobRun_upd" BEFORE UPDATE ON "JobRun"
WHEN
  NEW."schoolId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "School" S WHERE S."id" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: JobRun.schoolId must reference a School'); END;

-- ── WebhookEvent.attempts ────────────────────────────────────────────
ALTER TABLE "WebhookEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
