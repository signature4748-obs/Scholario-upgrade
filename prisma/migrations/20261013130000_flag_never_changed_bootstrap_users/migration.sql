-- Honest-signal closure for legacy SUPER_ADMIN / school-less User rows that the
-- 20261004150000_credential_neutralization predicate structurally could not flag
-- (it excluded role = 'SUPER_ADMIN' and schoolId IS NULL). Those accounts are inert
-- (the login role-allowlist refuses SUPER_ADMIN; schoolScoped() rejects them), but the
-- invariant "mustChangePassword = false implies the owner completed a rotation" must
-- hold for EVERY row that still runs on a bootstrap password.
UPDATE "User" SET "mustChangePassword" = true
WHERE "passwordChangedAt" IS NULL AND "mustChangePassword" = false;
