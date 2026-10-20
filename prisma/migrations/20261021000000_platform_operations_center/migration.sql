-- ============================================================================
-- PLATFORM OPERATIONS CENTER — observability, usage & limits, error
-- diagnosis, service health.
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. No table is reset, truncated, dropped or reseeded; every
-- existing row and behavior is untouched (the CI drift gate re-verifies:
-- replaying all migrations must equal the schema datamodel).
--
-- Conventions carried over from the platform plane:
--   · NO FOREIGN KEYS on operations rows — operational history must
--     SURVIVE the deletion of the school/admin it describes (the same
--     rule PlatformAuditLog documents). Every schoolId below is an
--     informational pointer, never a relation.
--   · 'String' columns via TEXT (Prisma Postgres default), cuid PKs,
--     DateTime via TIMESTAMP(3) — identical to every existing model.
--   · Date-typed columns (@db.Date) via DATE (SchoolUsageDaily.date,
--     SchoolActiveUserDay.date).
--   · Unknown limits are NULL, never 0 (rendered "not reported", never
--     "of 0").
--
-- Objects created (9 tables):
--   ProviderUsageSnapshot, ProviderSyncRun, OperationalError,
--   OperationalErrorEvent, PlatformAlert, PlatformAlertSetting,
--   SchoolUsageDaily, SchoolActiveUserDay, MonitoringCheck
-- ============================================================================

-- ── ProviderUsageSnapshot — cached provider metrics (sync-service writes) ──
CREATE TABLE "ProviderUsageSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "limitValue" DOUBLE PRECISION,
    "measured" BOOLEAN NOT NULL DEFAULT true,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "availability" TEXT NOT NULL DEFAULT 'ok',
    "meta" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT
);
CREATE INDEX "ProviderUsageSnapshot_provider_scope_metric_collectedAt_idx"
    ON "ProviderUsageSnapshot"("provider", "scope", "metric", "collectedAt");
CREATE INDEX "ProviderUsageSnapshot_collectedAt_idx"
    ON "ProviderUsageSnapshot"("collectedAt");

-- ── ProviderSyncRun — one row per provider synchronization attempt ─────────
CREATE TABLE "ProviderSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "metricsWritten" INTEGER NOT NULL DEFAULT 0,
    "metricsUnavailable" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT
);
CREATE INDEX "ProviderSyncRun_provider_startedAt_idx"
    ON "ProviderSyncRun"("provider", "startedAt");
CREATE INDEX "ProviderSyncRun_status_startedAt_idx"
    ON "ProviderSyncRun"("status", "startedAt");

-- ── OperationalError — error GROUP per stable fingerprint ──────────────────
CREATE TABLE "OperationalError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "status" TEXT NOT NULL DEFAULT 'open',
    "env" TEXT NOT NULL DEFAULT 'production',
    "message" TEXT NOT NULL,
    "lastRoute" TEXT,
    "lastMethod" TEXT,
    "lastStatusCode" INTEGER,
    "provider" TEXT,
    "schoolId" TEXT,
    "deploymentId" TEXT,
    "requestId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT
);
CREATE UNIQUE INDEX "OperationalError_fingerprint_key" ON "OperationalError"("fingerprint");
CREATE INDEX "OperationalError_status_severity_lastSeenAt_idx"
    ON "OperationalError"("status", "severity", "lastSeenAt");
CREATE INDEX "OperationalError_category_status_lastSeenAt_idx"
    ON "OperationalError"("category", "status", "lastSeenAt");
CREATE INDEX "OperationalError_schoolId_lastSeenAt_idx"
    ON "OperationalError"("schoolId", "lastSeenAt");
CREATE INDEX "OperationalError_lastSeenAt_idx" ON "OperationalError"("lastSeenAt");

-- ── OperationalErrorEvent — per-occurrence records (retention-pruned) ─────
CREATE TABLE "OperationalErrorEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "route" TEXT,
    "statusCode" INTEGER,
    "deploymentId" TEXT,
    "schoolId" TEXT,
    "brief" TEXT
);
CREATE INDEX "OperationalErrorEvent_fingerprint_occurredAt_idx"
    ON "OperationalErrorEvent"("fingerprint", "occurredAt");
CREATE INDEX "OperationalErrorEvent_occurredAt_idx"
    ON "OperationalErrorEvent"("occurredAt");

-- ── PlatformAlert — deduplicated threshold/incident alerts ────────────────
CREATE TABLE "PlatformAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "status" TEXT NOT NULL DEFAULT 'open',
    "metricKey" TEXT NOT NULL,
    "metricLabel" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "acknowledgedBy" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT
);
CREATE UNIQUE INDEX "PlatformAlert_fingerprint_key" ON "PlatformAlert"("fingerprint");
CREATE INDEX "PlatformAlert_status_severity_lastSeenAt_idx"
    ON "PlatformAlert"("status", "severity", "lastSeenAt");
CREATE INDEX "PlatformAlert_type_status_lastSeenAt_idx"
    ON "PlatformAlert"("type", "status", "lastSeenAt");

-- ── PlatformAlertSetting — operator-configurable thresholds ──────────────
CREATE TABLE "PlatformAlertSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PlatformAlertSetting_updatedAt_idx" ON "PlatformAlertSetting"("updatedAt");

-- ── SchoolUsageDaily — per-school daily apiOperations rollup ──────────────
CREATE TABLE "SchoolUsageDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "apiOperations" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "SchoolUsageDaily_schoolId_date_key" ON "SchoolUsageDaily"("schoolId", "date");
CREATE INDEX "SchoolUsageDaily_date_idx" ON "SchoolUsageDaily"("date");

-- ── SchoolActiveUserDay — distinct (school,user,day) activity ──────────────
CREATE TABLE "SchoolActiveUserDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "role" TEXT
);
CREATE UNIQUE INDEX "SchoolActiveUserDay_schoolId_userId_date_key"
    ON "SchoolActiveUserDay"("schoolId", "userId", "date");
CREATE INDEX "SchoolActiveUserDay_schoolId_date_idx" ON "SchoolActiveUserDay"("schoolId", "date");
CREATE INDEX "SchoolActiveUserDay_date_idx" ON "SchoolActiveUserDay"("date");

-- ── MonitoringCheck — service-health check history ────────────────────────
CREATE TABLE "MonitoringCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checkKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "latencyMs" INTEGER,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MonitoringCheck_checkKey_checkedAt_idx"
    ON "MonitoringCheck"("checkKey", "checkedAt");
CREATE INDEX "MonitoringCheck_checkedAt_idx" ON "MonitoringCheck"("checkedAt");
