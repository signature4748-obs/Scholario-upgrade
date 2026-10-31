-- PHASE 3 — Role-wise Feature Control — ADDITIVE migration.
--
-- One row = "this school explicitly DISABLED this feature for this
-- canonical school role" (see model comment in prisma/schema.prisma and
-- docs/super-admin-transformation/PHASE-3-ARCHITECTURE.md §5.4).
--
-- No existing column is dropped, retyped or rewritten; no data statements.
-- Every existing school starts with ZERO rows ⇒ the effective permission
-- decision is unchanged (it inherits the static RBAC baseline exactly as
-- before this migration). Backward compatible in both deploy directions:
-- old code ignores the table; new code with no rows behaves identically
-- to the pre-Phase-3 application.
--
-- `role` is validated against the canonical school-role set (PRINCIPAL |
-- TEACHER | STUDENT) and `featureKey` against the code-owned catalog
-- (ROLE_FEATURE_CATALOG) by the service layer BEFORE any write; the
-- unique constraint is the concurrency backstop.

-- CreateTable
CREATE TABLE "RoleFeatureOverride" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "denied" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleFeatureOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleFeatureOverride_schoolId_role_featureKey_key" ON "RoleFeatureOverride"("schoolId", "role", "featureKey");

-- CreateIndex
CREATE INDEX "RoleFeatureOverride_schoolId_role_idx" ON "RoleFeatureOverride"("schoolId", "role");

-- AddForeignKey
ALTER TABLE "RoleFeatureOverride" ADD CONSTRAINT "RoleFeatureOverride_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
