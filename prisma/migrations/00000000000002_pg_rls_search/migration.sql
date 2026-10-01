-- PHASE 8A — RLS DEFENSE-IN-DEPTH + TRIGRAM SEARCH INDEXES (additive)
--
-- 1. ROW LEVEL SECURITY on every application table (public schema).
--    NO policies are created for `anon`/`authenticated` — Supabase's
--    PostgREST surface therefore gets DEFAULT-DENY on all app tables:
--    a leaked anon (publishable) key can read NOTHING. The application
--    connects as `postgres` (bypassrls) and keeps its hardened
--    service-layer authorization as the app boundary; `service_role`
--    (bypassrls) remains server-side-only. RLS here is defense-in-depth
--    against direct query abuse through the exposed REST surface —
--    it does NOT replace application authorization.
--    (No permissive USING(true) policies exist — see mission §12.)
--
-- 2. pg_trgm GIN indexes on the user-facing search columns (the ⌘K
--    palette, platform schools/audit search, students/contacts, homework,
--    class/timetable name lookups). Prisma `mode: 'insensitive'` (ILIKE)
--    becomes an indexed scan instead of a seq-scan.

-- ── pg_trgm ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── trigram GIN indexes (search surface census: Phase 8A recon 8A-R2) ─
CREATE INDEX "User_name_trgm" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Student_admissionNo_trgm" ON "Student" USING gin ("admissionNo" gin_trgm_ops);
CREATE INDEX "Teacher_employeeId_trgm" ON "Teacher" USING gin ("employeeId" gin_trgm_ops);
CREATE INDEX "Fee_title_trgm" ON "Fee" USING gin ("title" gin_trgm_ops);
CREATE INDEX "Notification_title_trgm" ON "Notification" USING gin ("title" gin_trgm_ops);
CREATE INDEX "Notification_message_trgm" ON "Notification" USING gin ("message" gin_trgm_ops);
CREATE INDEX "Message_subject_trgm" ON "Message" USING gin ("subject" gin_trgm_ops);
CREATE INDEX "Message_body_trgm" ON "Message" USING gin ("body" gin_trgm_ops);
CREATE INDEX "StudyMaterial_title_trgm" ON "StudyMaterial" USING gin ("title" gin_trgm_ops);
CREATE INDEX "StudyMaterial_description_trgm" ON "StudyMaterial" USING gin ("description" gin_trgm_ops);
CREATE INDEX "FlashcardDeck_name_trgm" ON "FlashcardDeck" USING gin ("name" gin_trgm_ops);
CREATE INDEX "StudyGroup_name_trgm" ON "StudyGroup" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Class_name_trgm" ON "Class" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Timetable_teacherName_trgm" ON "Timetable" USING gin ("teacherName" gin_trgm_ops);
CREATE INDEX "School_name_trgm" ON "School" USING gin ("name" gin_trgm_ops);
CREATE INDEX "School_slug_trgm" ON "School" USING gin ("slug" gin_trgm_ops);
CREATE INDEX "School_code_trgm" ON "School" USING gin ("code" gin_trgm_ops);
CREATE INDEX "School_domain_trgm" ON "School" USING gin ("domain" gin_trgm_ops);
CREATE INDEX "PlatformAuditLog_action_trgm" ON "PlatformAuditLog" USING gin ("action" gin_trgm_ops);
CREATE INDEX "PlatformAuditLog_reason_trgm" ON "PlatformAuditLog" USING gin ("reason" gin_trgm_ops);
CREATE INDEX "ParentMessage_body_trgm" ON "ParentMessage" USING gin ("body" gin_trgm_ops);
CREATE INDEX "GrowthEvent_reason_trgm" ON "GrowthEvent" USING gin ("reason" gin_trgm_ops);
CREATE INDEX "TeacherFollowUp_reason_trgm" ON "TeacherFollowUp" USING gin ("reason" gin_trgm_ops);
CREATE INDEX "GrowthRule_label_trgm" ON "GrowthRule" USING gin ("label" gin_trgm_ops);

-- ── RLS: enable on EVERY application table (deny-by-default) ─────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relispartition = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
  END LOOP;
END $$;
