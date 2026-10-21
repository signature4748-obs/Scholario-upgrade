-- ROOT-ADMIN LOGIN REPAIR — recovery tokens may bind a candidate email.
--
-- The audited recovery procedure (scripts/prod-release/root-email-recovery.ts)
-- mints a reset token that ALSO designates a new account email (the
-- administrator's verified Gmail). The ownership proof is the emailed
-- single-use link itself: only the candidate mailbox can present the
-- token, so the email is only ever adopted when the recovery link sent
-- to that address is consumed. Ordinary self-service forgot-password
-- rows keep newEmail NULL — behavior byte-identical for them.
--
-- Additive, nullable: no backfill needed, no behavior change for
-- existing rows, reversible by dropping the column.

ALTER TABLE "PlatformPasswordReset" ADD COLUMN "newEmail" TEXT;
