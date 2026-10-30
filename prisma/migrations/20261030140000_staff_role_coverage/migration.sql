-- Staff role coverage — ADDITIVE migration (subscription UX redesign,
-- PHASE 5C: "a plan MUST explicitly define which staff roles it covers").
--
-- Two nullable JSONB columns that make the staff role-coverage policy
-- DECLARATIVE and auditable instead of hard-coded:
--   · SubscriptionPlan.coveredRoles    — the plan's declared covered
--     staff roles (STAFF-scope plans).
--   · SchoolSubscription.staffCoverageRoles — the tenant-level override
--     snapshot (terms route; null → plan's → ["TEACHER"]).
--
-- No existing column is dropped, retyped or rewritten; no data statements.
-- Every existing tenant's effective behavior is UNCHANGED: null on both
-- columns resolves to the legacy default ["TEACHER"], and the per-seat
-- gate / code claim / batch assignment / roster paths all normalize the
-- value server-side (values outside the seat-eligible canonical set are
-- dropped on write AND read — a bad write can never widen the policy).

ALTER TABLE "SubscriptionPlan" ADD COLUMN "coveredRoles" JSONB;
ALTER TABLE "SchoolSubscription" ADD COLUMN "staffCoverageRoles" JSONB;
