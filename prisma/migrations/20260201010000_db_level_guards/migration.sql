-- PHASE 3 — DATABASE-LEVEL GUARDS (defense-in-depth, SQLite)
--
-- The Phase 2 service layer already refuses cross-tenant writes at the
-- authorization boundary. These BEFORE INSERT/UPDATE triggers make the
-- DATABASE itself refuse them, so no future code path (a new route, a
-- stray script, a raw prisma call) can silently link School A rows to
-- School B parents. Triggers (not CHECK constraints) are used because:
--   · SQLite cannot ALTER TABLE ... ADD CHECK without a full rebuild;
--   · triggers can reference OTHER tables (marks ≤ ExamSubjectConfig);
--   · Prisma's differ does not manage triggers → zero drift risk.
-- The Postgres migration plan (docs/POSTGRES_MIGRATION_PLAN.md) replaces
-- these with CHECK constraints, partial unique indexes and RLS.
--
-- Verified pre-conditions (prisma/audit-db-integrity.ts, 2026-02-01):
-- zero existing violations on every guarded pair — no row is frozen.

-- ════════════════════════════════════════════════════════════════════
-- 1. TENANT GUARDS — a child row may only reference parent rows that
--    belong to the SAME school (or, for school-less child tables, whose
--    parents belong to the same school).
-- ════════════════════════════════════════════════════════════════════

-- ── Student → Class / Route / guardian User ─────────────────────────
CREATE TRIGGER "tg_guard_Student_ins" BEFORE INSERT ON "Student"
WHEN
  (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
  OR (NEW."routeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Route" R WHERE R."id" = NEW."routeId" AND R."schoolId" = NEW."schoolId"))
  OR (NEW."guardianId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."guardianId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Student references another school''s row'); END;

CREATE TRIGGER "tg_guard_Student_upd" BEFORE UPDATE ON "Student"
WHEN
  (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
  OR (NEW."routeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Route" R WHERE R."id" = NEW."routeId" AND R."schoolId" = NEW."schoolId"))
  OR (NEW."guardianId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."guardianId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Student references another school''s row'); END;

-- ── Class → Room / classTeacher User ────────────────────────────────
CREATE TRIGGER "tg_guard_Class_ins" BEFORE INSERT ON "Class"
WHEN
  (NEW."roomId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Room" R WHERE R."id" = NEW."roomId" AND R."schoolId" = NEW."schoolId"))
  OR (NEW."classTeacherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."classTeacherId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Class references another school''s row'); END;

CREATE TRIGGER "tg_guard_Class_upd" BEFORE UPDATE ON "Class"
WHEN
  (NEW."roomId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Room" R WHERE R."id" = NEW."roomId" AND R."schoolId" = NEW."schoolId"))
  OR (NEW."classTeacherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."classTeacherId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Class references another school''s row'); END;

-- ── ClassSubjectAssignment → Class / Subject / teacher User ─────────
CREATE TRIGGER "tg_guard_CSA_ins" BEFORE INSERT ON "ClassSubjectAssignment"
WHEN
  NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."teacherUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherUserId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ClassSubjectAssignment references another school''s row'); END;

CREATE TRIGGER "tg_guard_CSA_upd" BEFORE UPDATE ON "ClassSubjectAssignment"
WHEN
  NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."teacherUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherUserId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ClassSubjectAssignment references another school''s row'); END;

-- ── Exam → Class ────────────────────────────────────────────────────
CREATE TRIGGER "tg_guard_Exam_ins" BEFORE INSERT ON "Exam"
WHEN (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Exam references another school''s class'); END;

CREATE TRIGGER "tg_guard_Exam_upd" BEFORE UPDATE ON "Exam"
WHEN (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Exam references another school''s class'); END;

-- ── ExamClass → Exam + Class same school ────────────────────────────
CREATE TRIGGER "tg_guard_ExamClass_ins" BEFORE INSERT ON "ExamClass"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND C."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamClass links exams/classes across schools'); END;

CREATE TRIGGER "tg_guard_ExamClass_upd" BEFORE UPDATE ON "ExamClass"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND C."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamClass links exams/classes across schools'); END;

-- ── ExamSubjectConfig → Exam + Class + Subject same school ──────────
CREATE TRIGGER "tg_guard_ESC_ins" BEFORE INSERT ON "ExamSubjectConfig"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C, "Subject" S WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND S."id" = NEW."subjectId" AND C."schoolId" = E."schoolId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamSubjectConfig links rows across schools'); END;

CREATE TRIGGER "tg_guard_ESC_upd" BEFORE UPDATE ON "ExamSubjectConfig"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C, "Subject" S WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND S."id" = NEW."subjectId" AND C."schoolId" = E."schoolId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamSubjectConfig links rows across schools'); END;

-- ── ExamScheduleItem → Exam + Class + Subject same school ───────────
CREATE TRIGGER "tg_guard_ESI_ins" BEFORE INSERT ON "ExamScheduleItem"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C, "Subject" S WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND S."id" = NEW."subjectId" AND C."schoolId" = E."schoolId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamScheduleItem links rows across schools'); END;

CREATE TRIGGER "tg_guard_ESI_upd" BEFORE UPDATE ON "ExamScheduleItem"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C, "Subject" S WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND S."id" = NEW."subjectId" AND C."schoolId" = E."schoolId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamScheduleItem links rows across schools'); END;

-- ── ExamMark → Student / Class / Subject all in the Exam's school ───
CREATE TRIGGER "tg_guard_ExamMark_ins" BEFORE INSERT ON "ExamMark"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S, "Class" C, "Subject" SU WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND C."id" = NEW."classId" AND SU."id" = NEW."subjectId" AND S."schoolId" = E."schoolId" AND C."schoolId" = E."schoolId" AND SU."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamMark links rows across schools'); END;

CREATE TRIGGER "tg_guard_ExamMark_upd" BEFORE UPDATE ON "ExamMark"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S, "Class" C, "Subject" SU WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND C."id" = NEW."classId" AND SU."id" = NEW."subjectId" AND S."schoolId" = E."schoolId" AND C."schoolId" = E."schoolId" AND SU."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamMark links rows across schools'); END;

-- ── ExamAttendance → Student / Subject in the Exam's school ─────────
CREATE TRIGGER "tg_guard_EA_ins" BEFORE INSERT ON "ExamAttendance"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Exam" E2, "Subject" SU WHERE E2."id" = NEW."examId" AND SU."id" = NEW."subjectId" AND SU."schoolId" = E2."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamAttendance links rows across schools'); END;

CREATE TRIGGER "tg_guard_EA_upd" BEFORE UPDATE ON "ExamAttendance"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Exam" E2, "Subject" SU WHERE E2."id" = NEW."examId" AND SU."id" = NEW."subjectId" AND SU."schoolId" = E2."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamAttendance links rows across schools'); END;

-- ── ExamSeatAssignment / ExamResultOutcome → Student in Exam school ─
CREATE TRIGGER "tg_guard_ESA_ins" BEFORE INSERT ON "ExamSeatAssignment"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamSeatAssignment links rows across schools'); END;

CREATE TRIGGER "tg_guard_ESA_upd" BEFORE UPDATE ON "ExamSeatAssignment"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamSeatAssignment links rows across schools'); END;

CREATE TRIGGER "tg_guard_ERO_ins" BEFORE INSERT ON "ExamResultOutcome"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamResultOutcome links rows across schools'); END;

CREATE TRIGGER "tg_guard_ERO_upd" BEFORE UPDATE ON "ExamResultOutcome"
WHEN NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ExamResultOutcome links rows across schools'); END;

-- ── Result → Student / Exam / Subject same school ───────────────────
CREATE TRIGGER "tg_guard_Result_ins" BEFORE INSERT ON "Result"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S, "Exam" E, "Subject" SU WHERE S."id" = NEW."studentId" AND E."id" = NEW."examId" AND SU."id" = NEW."subjectId" AND S."schoolId" = E."schoolId" AND SU."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Result links rows across schools'); END;

CREATE TRIGGER "tg_guard_Result_upd" BEFORE UPDATE ON "Result"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S, "Exam" E, "Subject" SU WHERE S."id" = NEW."studentId" AND E."id" = NEW."examId" AND SU."id" = NEW."subjectId" AND S."schoolId" = E."schoolId" AND SU."schoolId" = E."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Result links rows across schools'); END;

-- ── Attendance → Student / Class in row's school ────────────────────
CREATE TRIGGER "tg_guard_Attendance_ins" BEFORE INSERT ON "Attendance"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Attendance references another school''s row'); END;

CREATE TRIGGER "tg_guard_Attendance_upd" BEFORE UPDATE ON "Attendance"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Attendance references another school''s row'); END;

-- ── AttendanceDraft / AttendanceAuditLog ────────────────────────────
CREATE TRIGGER "tg_guard_AD_ins" BEFORE INSERT ON "AttendanceDraft"
WHEN NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: AttendanceDraft references another school''s class'); END;

CREATE TRIGGER "tg_guard_AD_upd" BEFORE UPDATE ON "AttendanceDraft"
WHEN NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: AttendanceDraft references another school''s class'); END;

CREATE TRIGGER "tg_guard_AAL_ins" BEFORE INSERT ON "AttendanceAuditLog"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: AttendanceAuditLog references another school''s student'); END;

CREATE TRIGGER "tg_guard_AAL_upd" BEFORE UPDATE ON "AttendanceAuditLog"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: AttendanceAuditLog references another school''s student'); END;

-- ── Timetable → Class / Subject / teacher User in row's school ──────
CREATE TRIGGER "tg_guard_Timetable_ins" BEFORE INSERT ON "Timetable"
WHEN NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."teacherUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherUserId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Timetable references another school''s row'); END;

CREATE TRIGGER "tg_guard_Timetable_upd" BEFORE UPDATE ON "Timetable"
WHEN NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."teacherUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherUserId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Timetable references another school''s row'); END;

-- ── Fee → Student in row's school ───────────────────────────────────
CREATE TRIGGER "tg_guard_Fee_ins" BEFORE INSERT ON "Fee"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Fee references another school''s student'); END;

CREATE TRIGGER "tg_guard_Fee_upd" BEFORE UPDATE ON "Fee"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Fee references another school''s student'); END;

-- ── Payment → Fee in row's school + schoolId mandatory ──────────────
CREATE TRIGGER "tg_guard_Payment_ins" BEFORE INSERT ON "Payment"
WHEN NEW."schoolId" IS NULL OR NEW."schoolId" = ''
  OR (NEW."feeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Fee" F WHERE F."id" = NEW."feeId" AND F."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Payment is not school-bound or references another school''s fee'); END;

CREATE TRIGGER "tg_guard_Payment_upd" BEFORE UPDATE ON "Payment"
WHEN NEW."schoolId" IS NULL OR NEW."schoolId" = ''
  OR (NEW."feeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Fee" F WHERE F."id" = NEW."feeId" AND F."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Payment is not school-bound or references another school''s fee'); END;

-- ── FeeTransaction → Student / Fee / FeeStructure (plain-string refs) ─
CREATE TRIGGER "tg_guard_FT_ins" BEFORE INSERT ON "FeeTransaction"
WHEN
  (NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."feeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Fee" F WHERE F."id" = NEW."feeId" AND F."schoolId" = NEW."schoolId"))
  OR (NEW."structureId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FeeStructure" FS WHERE FS."id" = NEW."structureId" AND FS."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: FeeTransaction references another school''s row'); END;

CREATE TRIGGER "tg_guard_FT_upd" BEFORE UPDATE ON "FeeTransaction"
WHEN
  (NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."feeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Fee" F WHERE F."id" = NEW."feeId" AND F."schoolId" = NEW."schoolId"))
  OR (NEW."structureId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FeeStructure" FS WHERE FS."id" = NEW."structureId" AND FS."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: FeeTransaction references another school''s row'); END;

-- ── BookIssue → Student in the Book's school ────────────────────────
CREATE TRIGGER "tg_guard_BookIssue_ins" BEFORE INSERT ON "BookIssue"
WHEN (NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LibraryBook" B, "Student" S WHERE B."id" = NEW."bookId" AND S."id" = NEW."studentId" AND S."schoolId" = B."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: BookIssue links rows across schools'); END;

CREATE TRIGGER "tg_guard_BookIssue_upd" BEFORE UPDATE ON "BookIssue"
WHEN (NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LibraryBook" B, "Student" S WHERE B."id" = NEW."bookId" AND S."id" = NEW."studentId" AND S."schoolId" = B."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: BookIssue links rows across schools'); END;

-- ── Homework → Class / Subject / teacher User in row's school ───────
CREATE TRIGGER "tg_guard_Homework_ins" BEFORE INSERT ON "Homework"
WHEN NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."teacherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Homework references another school''s row'); END;

CREATE TRIGGER "tg_guard_Homework_upd" BEFORE UPDATE ON "Homework"
WHEN NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."teacherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherId" AND U."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Homework references another school''s row'); END;

-- ── HomeworkSubmission → Student + Homework in row's school ─────────
CREATE TRIGGER "tg_guard_HS_ins" BEFORE INSERT ON "HomeworkSubmission"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR NOT EXISTS (SELECT 1 FROM "Homework" H WHERE H."id" = NEW."homeworkId" AND H."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: HomeworkSubmission references another school''s row'); END;

CREATE TRIGGER "tg_guard_HS_upd" BEFORE UPDATE ON "HomeworkSubmission"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR NOT EXISTS (SELECT 1 FROM "Homework" H WHERE H."id" = NEW."homeworkId" AND H."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: HomeworkSubmission references another school''s row'); END;

-- ── StudyMaterial → Subject (loose FK) in row's school ──────────────
CREATE TRIGGER "tg_guard_SM_ins" BEFORE INSERT ON "StudyMaterial"
WHEN (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: StudyMaterial references another school''s subject'); END;

CREATE TRIGGER "tg_guard_SM_upd" BEFORE UPDATE ON "StudyMaterial"
WHEN (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: StudyMaterial references another school''s subject'); END;

-- ── StudyMaterialTarget → Student in material's school ──────────────
CREATE TRIGGER "tg_guard_SMT_ins" BEFORE INSERT ON "StudyMaterialTarget"
WHEN NOT EXISTS (SELECT 1 FROM "StudyMaterial" M, "Student" S WHERE M."id" = NEW."studyMaterialId" AND S."id" = NEW."studentId" AND S."schoolId" = M."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: StudyMaterialTarget links rows across schools'); END;

CREATE TRIGGER "tg_guard_SMT_upd" BEFORE UPDATE ON "StudyMaterialTarget"
WHEN NOT EXISTS (SELECT 1 FROM "StudyMaterial" M, "Student" S WHERE M."id" = NEW."studyMaterialId" AND S."id" = NEW."studentId" AND S."schoolId" = M."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: StudyMaterialTarget links rows across schools'); END;

-- ── QuestionBank → Subject / Class in row's school ──────────────────
CREATE TRIGGER "tg_guard_QB_ins" BEFORE INSERT ON "QuestionBank"
WHEN
  (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: QuestionBank references another school''s row'); END;

CREATE TRIGGER "tg_guard_QB_upd" BEFORE UPDATE ON "QuestionBank"
WHEN
  (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: QuestionBank references another school''s row'); END;

-- ── GrowthEvent / BehaviorRecord → Student in row's school ─────────
CREATE TRIGGER "tg_guard_GE_ins" BEFORE INSERT ON "GrowthEvent"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: GrowthEvent references another school''s student'); END;

CREATE TRIGGER "tg_guard_GE_upd" BEFORE UPDATE ON "GrowthEvent"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: GrowthEvent references another school''s student'); END;

CREATE TRIGGER "tg_guard_BR_ins" BEFORE INSERT ON "BehaviorRecord"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: BehaviorRecord references another school''s student'); END;

CREATE TRIGGER "tg_guard_BR_upd" BEFORE UPDATE ON "BehaviorRecord"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: BehaviorRecord references another school''s student'); END;

-- ── ParentConversation → teacher User / parent User / Student ───────
CREATE TRIGGER "tg_guard_PC_ins" BEFORE INSERT ON "ParentConversation"
WHEN NOT EXISTS (SELECT 1 FROM "User" T, "User" P, "Student" S WHERE T."id" = NEW."teacherId" AND P."id" = NEW."parentId" AND S."id" = NEW."studentId" AND T."schoolId" = NEW."schoolId" AND P."schoolId" = NEW."schoolId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ParentConversation links rows across schools'); END;

CREATE TRIGGER "tg_guard_PC_upd" BEFORE UPDATE ON "ParentConversation"
WHEN NOT EXISTS (SELECT 1 FROM "User" T, "User" P, "Student" S WHERE T."id" = NEW."teacherId" AND P."id" = NEW."parentId" AND S."id" = NEW."studentId" AND T."schoolId" = NEW."schoolId" AND P."schoolId" = NEW."schoolId" AND S."schoolId" = NEW."schoolId")
BEGIN SELECT RAISE(ABORT, 'tenant-guard: ParentConversation links rows across schools'); END;

-- ── Assignment → Class / Subject in row's school ────────────────────
CREATE TRIGGER "tg_guard_Assignment_ins" BEFORE INSERT ON "Assignment"
WHEN
  (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Assignment references another school''s row'); END;

CREATE TRIGGER "tg_guard_Assignment_upd" BEFORE UPDATE ON "Assignment"
WHEN
  (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Assignment references another school''s row'); END;

-- ── StudyTask → Student / Subject in row's school ───────────────────
CREATE TRIGGER "tg_guard_ST_ins" BEFORE INSERT ON "StudyTask"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" SU WHERE SU."id" = NEW."subjectId" AND SU."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: StudyTask references another school''s row'); END;

CREATE TRIGGER "tg_guard_ST_upd" BEFORE UPDATE ON "StudyTask"
WHEN NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" SU WHERE SU."id" = NEW."subjectId" AND SU."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: StudyTask references another school''s row'); END;

-- ── Reconciliation → FeeTransaction / Settlement in row's school ────
CREATE TRIGGER "tg_guard_Rec_ins" BEFORE INSERT ON "Reconciliation"
WHEN NOT EXISTS (SELECT 1 FROM "FeeTransaction" T WHERE T."id" = NEW."transactionId" AND T."schoolId" = NEW."schoolId")
  OR (NEW."settlementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Settlement" X WHERE X."id" = NEW."settlementId" AND X."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Reconciliation links rows across schools'); END;

CREATE TRIGGER "tg_guard_Rec_upd" BEFORE UPDATE ON "Reconciliation"
WHEN NOT EXISTS (SELECT 1 FROM "FeeTransaction" T WHERE T."id" = NEW."transactionId" AND T."schoolId" = NEW."schoolId")
  OR (NEW."settlementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Settlement" X WHERE X."id" = NEW."settlementId" AND X."schoolId" = NEW."schoolId"))
BEGIN SELECT RAISE(ABORT, 'tenant-guard: Reconciliation links rows across schools'); END;

-- ════════════════════════════════════════════════════════════════════
-- 2. BUSINESS-INVARIANT BOUNDS (the "marks cannot exceed max" family)
-- ════════════════════════════════════════════════════════════════════

-- ExamMark: marksObtained ≥ 0, ≤ configured maxMarks (when a config row
-- exists), graceMarks ≥ 0.
CREATE TRIGGER "tg_bound_ExamMark_ins" BEFORE INSERT ON "ExamMark"
WHEN
  (NEW."marksObtained" IS NOT NULL AND (NEW."marksObtained" < 0 OR NEW."marksObtained" >
    COALESCE((SELECT CFG."maxMarks" FROM "ExamSubjectConfig" CFG WHERE CFG."examId" = NEW."examId" AND CFG."classId" = NEW."classId" AND CFG."subjectId" = NEW."subjectId"), 2147483647)))
  OR NEW."graceMarks" < 0
BEGIN SELECT RAISE(ABORT, 'bound-guard: ExamMark.marksObtained outside 0..maxMarks (or negative grace)'); END;

CREATE TRIGGER "tg_bound_ExamMark_upd" BEFORE UPDATE ON "ExamMark"
WHEN
  (NEW."marksObtained" IS NOT NULL AND (NEW."marksObtained" < 0 OR NEW."marksObtained" >
    COALESCE((SELECT CFG."maxMarks" FROM "ExamSubjectConfig" CFG WHERE CFG."examId" = NEW."examId" AND CFG."classId" = NEW."classId" AND CFG."subjectId" = NEW."subjectId"), 2147483647)))
  OR NEW."graceMarks" < 0
BEGIN SELECT RAISE(ABORT, 'bound-guard: ExamMark.marksObtained outside 0..maxMarks (or negative grace)'); END;

-- Result: 0 ≤ marks ≤ totalMarks
CREATE TRIGGER "tg_bound_Result_ins" BEFORE INSERT ON "Result"
WHEN NEW."marks" < 0 OR NEW."marks" > NEW."totalMarks"
BEGIN SELECT RAISE(ABORT, 'bound-guard: Result.marks outside 0..totalMarks'); END;

CREATE TRIGGER "tg_bound_Result_upd" BEFORE UPDATE ON "Result"
WHEN NEW."marks" < 0 OR NEW."marks" > NEW."totalMarks"
BEGIN SELECT RAISE(ABORT, 'bound-guard: Result.marks outside 0..totalMarks'); END;

-- Fee: 0 ≤ paid ≤ amount (no overpaid/negative ledgers)
CREATE TRIGGER "tg_bound_Fee_ins" BEFORE INSERT ON "Fee"
WHEN NEW."paid" < 0 OR NEW."paid" > NEW."amount"
BEGIN SELECT RAISE(ABORT, 'bound-guard: Fee.paid outside 0..amount'); END;

CREATE TRIGGER "tg_bound_Fee_upd" BEFORE UPDATE ON "Fee"
WHEN NEW."paid" < 0 OR NEW."paid" > NEW."amount"
BEGIN SELECT RAISE(ABORT, 'bound-guard: Fee.paid outside 0..amount'); END;

-- Payment: amount > 0 (money mirrors are strictly positive)
CREATE TRIGGER "tg_bound_Payment_ins" BEFORE INSERT ON "Payment"
WHEN NEW."amount" <= 0
BEGIN SELECT RAISE(ABORT, 'bound-guard: Payment.amount must be > 0'); END;

CREATE TRIGGER "tg_bound_Payment_upd" BEFORE UPDATE ON "Payment"
WHEN NEW."amount" <= 0
BEGIN SELECT RAISE(ABORT, 'bound-guard: Payment.amount must be > 0'); END;

-- FeeTransaction: amount > 0
CREATE TRIGGER "tg_bound_FT_ins" BEFORE INSERT ON "FeeTransaction"
WHEN NEW."amount" <= 0
BEGIN SELECT RAISE(ABORT, 'bound-guard: FeeTransaction.amount must be > 0'); END;

CREATE TRIGGER "tg_bound_FT_upd" BEFORE UPDATE ON "FeeTransaction"
WHEN NEW."amount" <= 0
BEGIN SELECT RAISE(ABORT, 'bound-guard: FeeTransaction.amount must be > 0'); END;

-- LibraryBook: 0 ≤ available ≤ copies
CREATE TRIGGER "tg_bound_LB_ins" BEFORE INSERT ON "LibraryBook"
WHEN NEW."available" < 0 OR NEW."available" > NEW."copies"
BEGIN SELECT RAISE(ABORT, 'bound-guard: LibraryBook.available outside 0..copies'); END;

CREATE TRIGGER "tg_bound_LB_upd" BEFORE UPDATE ON "LibraryBook"
WHEN NEW."available" < 0 OR NEW."available" > NEW."copies"
BEGIN SELECT RAISE(ABORT, 'bound-guard: LibraryBook.available outside 0..copies'); END;

-- Timetable: period ≥ 1 (period index starts at 1)
CREATE TRIGGER "tg_bound_TT_ins" BEFORE INSERT ON "Timetable"
WHEN NEW."period" < 1
BEGIN SELECT RAISE(ABORT, 'bound-guard: Timetable.period must be >= 1'); END;

CREATE TRIGGER "tg_bound_TT_upd" BEFORE UPDATE ON "Timetable"
WHEN NEW."period" < 1
BEGIN SELECT RAISE(ABORT, 'bound-guard: Timetable.period must be >= 1'); END;
