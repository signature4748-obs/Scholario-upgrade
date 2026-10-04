/*
 * RESTORE pg_trgm SEARCH INDEXES — HIGH audit fix.
 *
 * Migration 20261004090000_saas_hardening_entitlement was authored from
 * a schema-diff that could not see the raw-SQL trgm indexes from
 * 00000000000002_pg_rls_search, so its DROP INDEX block removed all 24
 * GIN trgm indexes (search degraded to sequential scans on every
 * user-facing ⌘K / autocomplete surface). This migration re-creates
 * them 1:1 from the 0002 definitions.
 *
 * Idempotent guards (IF NOT EXISTS) keep this safe against any partial
 * state; the extension itself is likewise re-asserted.
 */
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- User-facing search columns (⌘K, rosters, autocomplete)
CREATE INDEX IF NOT EXISTS "User_name_trgm" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Student_admissionNo_trgm" ON "Student" USING gin ("admissionNo" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Teacher_employeeId_trgm" ON "Teacher" USING gin ("employeeId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Fee_title_trgm" ON "Fee" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Notification_title_trgm" ON "Notification" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Notification_message_trgm" ON "Notification" USING gin ("message" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Message_subject_trgm" ON "Message" USING gin ("subject" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Message_body_trgm" ON "Message" USING gin ("body" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "StudyMaterial_title_trgm" ON "StudyMaterial" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "StudyMaterial_description_trgm" ON "StudyMaterial" USING gin ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "FlashcardDeck_name_trgm" ON "FlashcardDeck" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "StudyGroup_name_trgm" ON "StudyGroup" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Class_name_trgm" ON "Class" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Timetable_teacherName_trgm" ON "Timetable" USING gin ("teacherName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "School_name_trgm" ON "School" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "School_slug_trgm" ON "School" USING gin ("slug" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "School_code_trgm" ON "School" USING gin ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "School_domain_trgm" ON "School" USING gin ("domain" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_action_trgm" ON "PlatformAuditLog" USING gin ("action" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_reason_trgm" ON "PlatformAuditLog" USING gin ("reason" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ParentMessage_body_trgm" ON "ParentMessage" USING gin ("body" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GrowthEvent_reason_trgm" ON "GrowthEvent" USING gin ("reason" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "TeacherFollowUp_reason_trgm" ON "TeacherFollowUp" USING gin ("reason" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GrowthRule_label_trgm" ON "GrowthRule" USING gin ("label" gin_trgm_ops);
