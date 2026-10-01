-- PHASE 8A — POSTGRES DOMAIN GUARDS (additive; reviewable)
--
-- Provenance: transliterated 1:1 from the SQLite lineage
-- (20260201010000_db_level_guards + JobRun guards from 20260202000000_observability)
-- by tmp-scripts/gen-pg-guards.ts. Semantics are IDENTICAL to the SQLite
-- originals (same conditions, same abort messages):
--   · tenant guards  — the DATABASE refuses cross-tenant references
--     (a child row may only reference parent rows of the SAME school);
--   · single-row bounds — native CHECK constraints (stricter typing, same
--     predicates the SQLite bound-triggers enforced);
--   · ExamMark ≤ maxMarks — cross-table, stays a trigger.
-- Prisma's own FK constraints (enforced natively on PG) cover existence;
-- these guards add the same-school dimension on top.

-- ═══ 1. TENANT GUARD FUNCTIONS (one per guarded table) ═══

CREATE FUNCTION "tg_guard_Assignment_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Assignment references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Assignment_ins" BEFORE INSERT ON "Assignment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Assignment_ins_fn"();
CREATE TRIGGER "tg_guard_Assignment_upd" BEFORE UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Assignment_ins_fn"();

CREATE FUNCTION "tg_guard_Attendance_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Attendance references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Attendance_ins" BEFORE INSERT ON "Attendance" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Attendance_ins_fn"();
CREATE TRIGGER "tg_guard_Attendance_upd" BEFORE UPDATE ON "Attendance" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Attendance_ins_fn"();

CREATE FUNCTION "tg_guard_AAL_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: AttendanceAuditLog references another school''s student';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_AAL_ins" BEFORE INSERT ON "AttendanceAuditLog" FOR EACH ROW EXECUTE FUNCTION "tg_guard_AAL_ins_fn"();
CREATE TRIGGER "tg_guard_AAL_upd" BEFORE UPDATE ON "AttendanceAuditLog" FOR EACH ROW EXECUTE FUNCTION "tg_guard_AAL_ins_fn"();

CREATE FUNCTION "tg_guard_AD_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: AttendanceDraft references another school''s class';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_AD_ins" BEFORE INSERT ON "AttendanceDraft" FOR EACH ROW EXECUTE FUNCTION "tg_guard_AD_ins_fn"();
CREATE TRIGGER "tg_guard_AD_upd" BEFORE UPDATE ON "AttendanceDraft" FOR EACH ROW EXECUTE FUNCTION "tg_guard_AD_ins_fn"();

CREATE FUNCTION "tg_guard_BR_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: BehaviorRecord references another school''s student';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_BR_ins" BEFORE INSERT ON "BehaviorRecord" FOR EACH ROW EXECUTE FUNCTION "tg_guard_BR_ins_fn"();
CREATE TRIGGER "tg_guard_BR_upd" BEFORE UPDATE ON "BehaviorRecord" FOR EACH ROW EXECUTE FUNCTION "tg_guard_BR_ins_fn"();

CREATE FUNCTION "tg_guard_BookIssue_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LibraryBook" B, "Student" S WHERE B."id" = NEW."bookId" AND S."id" = NEW."studentId" AND S."schoolId" = B."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: BookIssue links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_BookIssue_ins" BEFORE INSERT ON "BookIssue" FOR EACH ROW EXECUTE FUNCTION "tg_guard_BookIssue_ins_fn"();
CREATE TRIGGER "tg_guard_BookIssue_upd" BEFORE UPDATE ON "BookIssue" FOR EACH ROW EXECUTE FUNCTION "tg_guard_BookIssue_ins_fn"();

CREATE FUNCTION "tg_guard_Class_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."roomId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Room" R WHERE R."id" = NEW."roomId" AND R."schoolId" = NEW."schoolId"))
  OR (NEW."classTeacherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."classTeacherId" AND U."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Class references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Class_ins" BEFORE INSERT ON "Class" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Class_ins_fn"();
CREATE TRIGGER "tg_guard_Class_upd" BEFORE UPDATE ON "Class" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Class_ins_fn"();

CREATE FUNCTION "tg_guard_CSA_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."teacherUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherUserId" AND U."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: ClassSubjectAssignment references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_CSA_ins" BEFORE INSERT ON "ClassSubjectAssignment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_CSA_ins_fn"();
CREATE TRIGGER "tg_guard_CSA_upd" BEFORE UPDATE ON "ClassSubjectAssignment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_CSA_ins_fn"();

CREATE FUNCTION "tg_guard_Exam_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Exam references another school''s class';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Exam_ins" BEFORE INSERT ON "Exam" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Exam_ins_fn"();
CREATE TRIGGER "tg_guard_Exam_upd" BEFORE UPDATE ON "Exam" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Exam_ins_fn"();

CREATE FUNCTION "tg_guard_EA_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Exam" E2, "Subject" SU WHERE E2."id" = NEW."examId" AND SU."id" = NEW."subjectId" AND SU."schoolId" = E2."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: ExamAttendance links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_EA_ins" BEFORE INSERT ON "ExamAttendance" FOR EACH ROW EXECUTE FUNCTION "tg_guard_EA_ins_fn"();
CREATE TRIGGER "tg_guard_EA_upd" BEFORE UPDATE ON "ExamAttendance" FOR EACH ROW EXECUTE FUNCTION "tg_guard_EA_ins_fn"();

CREATE FUNCTION "tg_guard_ExamClass_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND C."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ExamClass links exams/classes across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ExamClass_ins" BEFORE INSERT ON "ExamClass" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ExamClass_ins_fn"();
CREATE TRIGGER "tg_guard_ExamClass_upd" BEFORE UPDATE ON "ExamClass" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ExamClass_ins_fn"();

CREATE FUNCTION "tg_guard_ExamMark_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S, "Class" C, "Subject" SU WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND C."id" = NEW."classId" AND SU."id" = NEW."subjectId" AND S."schoolId" = E."schoolId" AND C."schoolId" = E."schoolId" AND SU."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ExamMark links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ExamMark_ins" BEFORE INSERT ON "ExamMark" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ExamMark_ins_fn"();
CREATE TRIGGER "tg_guard_ExamMark_upd" BEFORE UPDATE ON "ExamMark" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ExamMark_ins_fn"();

CREATE FUNCTION "tg_guard_ERO_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ExamResultOutcome links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ERO_ins" BEFORE INSERT ON "ExamResultOutcome" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ERO_ins_fn"();
CREATE TRIGGER "tg_guard_ERO_upd" BEFORE UPDATE ON "ExamResultOutcome" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ERO_ins_fn"();

CREATE FUNCTION "tg_guard_ESI_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C, "Subject" S WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND S."id" = NEW."subjectId" AND C."schoolId" = E."schoolId" AND S."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ExamScheduleItem links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ESI_ins" BEFORE INSERT ON "ExamScheduleItem" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ESI_ins_fn"();
CREATE TRIGGER "tg_guard_ESI_upd" BEFORE UPDATE ON "ExamScheduleItem" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ESI_ins_fn"();

CREATE FUNCTION "tg_guard_ESA_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Student" S WHERE E."id" = NEW."examId" AND S."id" = NEW."studentId" AND S."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ExamSeatAssignment links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ESA_ins" BEFORE INSERT ON "ExamSeatAssignment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ESA_ins_fn"();
CREATE TRIGGER "tg_guard_ESA_upd" BEFORE UPDATE ON "ExamSeatAssignment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ESA_ins_fn"();

CREATE FUNCTION "tg_guard_ESC_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Exam" E, "Class" C, "Subject" S WHERE E."id" = NEW."examId" AND C."id" = NEW."classId" AND S."id" = NEW."subjectId" AND C."schoolId" = E."schoolId" AND S."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ExamSubjectConfig links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ESC_ins" BEFORE INSERT ON "ExamSubjectConfig" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ESC_ins_fn"();
CREATE TRIGGER "tg_guard_ESC_upd" BEFORE UPDATE ON "ExamSubjectConfig" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ESC_ins_fn"();

CREATE FUNCTION "tg_guard_Fee_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: Fee references another school''s student';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Fee_ins" BEFORE INSERT ON "Fee" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Fee_ins_fn"();
CREATE TRIGGER "tg_guard_Fee_upd" BEFORE UPDATE ON "Fee" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Fee_ins_fn"();

CREATE FUNCTION "tg_guard_FT_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."feeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Fee" F WHERE F."id" = NEW."feeId" AND F."schoolId" = NEW."schoolId"))
  OR (NEW."structureId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FeeStructure" FS WHERE FS."id" = NEW."structureId" AND FS."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: FeeTransaction references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_FT_ins" BEFORE INSERT ON "FeeTransaction" FOR EACH ROW EXECUTE FUNCTION "tg_guard_FT_ins_fn"();
CREATE TRIGGER "tg_guard_FT_upd" BEFORE UPDATE ON "FeeTransaction" FOR EACH ROW EXECUTE FUNCTION "tg_guard_FT_ins_fn"();

CREATE FUNCTION "tg_guard_GE_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: GrowthEvent references another school''s student';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_GE_ins" BEFORE INSERT ON "GrowthEvent" FOR EACH ROW EXECUTE FUNCTION "tg_guard_GE_ins_fn"();
CREATE TRIGGER "tg_guard_GE_upd" BEFORE UPDATE ON "GrowthEvent" FOR EACH ROW EXECUTE FUNCTION "tg_guard_GE_ins_fn"();

CREATE FUNCTION "tg_guard_Homework_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."teacherId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherId" AND U."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Homework references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Homework_ins" BEFORE INSERT ON "Homework" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Homework_ins_fn"();
CREATE TRIGGER "tg_guard_Homework_upd" BEFORE UPDATE ON "Homework" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Homework_ins_fn"();

CREATE FUNCTION "tg_guard_HS_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR NOT EXISTS (SELECT 1 FROM "Homework" H WHERE H."id" = NEW."homeworkId" AND H."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: HomeworkSubmission references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_HS_ins" BEFORE INSERT ON "HomeworkSubmission" FOR EACH ROW EXECUTE FUNCTION "tg_guard_HS_ins_fn"();
CREATE TRIGGER "tg_guard_HS_upd" BEFORE UPDATE ON "HomeworkSubmission" FOR EACH ROW EXECUTE FUNCTION "tg_guard_HS_ins_fn"();

CREATE FUNCTION "tg_guard_JobRun_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."schoolId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "School" S WHERE S."id" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: JobRun.schoolId must reference a School';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_JobRun_ins" BEFORE INSERT ON "JobRun" FOR EACH ROW EXECUTE FUNCTION "tg_guard_JobRun_ins_fn"();
CREATE TRIGGER "tg_guard_JobRun_upd" BEFORE UPDATE ON "JobRun" FOR EACH ROW EXECUTE FUNCTION "tg_guard_JobRun_ins_fn"();

CREATE FUNCTION "tg_guard_PC_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" T, "User" P, "Student" S WHERE T."id" = NEW."teacherId" AND P."id" = NEW."parentId" AND S."id" = NEW."studentId" AND T."schoolId" = NEW."schoolId" AND P."schoolId" = NEW."schoolId" AND S."schoolId" = NEW."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: ParentConversation links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_PC_ins" BEFORE INSERT ON "ParentConversation" FOR EACH ROW EXECUTE FUNCTION "tg_guard_PC_ins_fn"();
CREATE TRIGGER "tg_guard_PC_upd" BEFORE UPDATE ON "ParentConversation" FOR EACH ROW EXECUTE FUNCTION "tg_guard_PC_ins_fn"();

CREATE FUNCTION "tg_guard_Payment_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."schoolId" IS NULL OR NEW."schoolId" = ''
  OR (NEW."feeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Fee" F WHERE F."id" = NEW."feeId" AND F."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Payment is not school-bound or references another school''s fee';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Payment_ins" BEFORE INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Payment_ins_fn"();
CREATE TRIGGER "tg_guard_Payment_upd" BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Payment_ins_fn"();

CREATE FUNCTION "tg_guard_QB_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: QuestionBank references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_QB_ins" BEFORE INSERT ON "QuestionBank" FOR EACH ROW EXECUTE FUNCTION "tg_guard_QB_ins_fn"();
CREATE TRIGGER "tg_guard_QB_upd" BEFORE UPDATE ON "QuestionBank" FOR EACH ROW EXECUTE FUNCTION "tg_guard_QB_ins_fn"();

CREATE FUNCTION "tg_guard_Rec_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "FeeTransaction" T WHERE T."id" = NEW."transactionId" AND T."schoolId" = NEW."schoolId")
  OR (NEW."settlementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Settlement" X WHERE X."id" = NEW."settlementId" AND X."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Reconciliation links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Rec_ins" BEFORE INSERT ON "Reconciliation" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Rec_ins_fn"();
CREATE TRIGGER "tg_guard_Rec_upd" BEFORE UPDATE ON "Reconciliation" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Rec_ins_fn"();

CREATE FUNCTION "tg_guard_Result_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S, "Exam" E, "Subject" SU WHERE S."id" = NEW."studentId" AND E."id" = NEW."examId" AND SU."id" = NEW."subjectId" AND S."schoolId" = E."schoolId" AND SU."schoolId" = E."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: Result links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Result_ins" BEFORE INSERT ON "Result" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Result_ins_fn"();
CREATE TRIGGER "tg_guard_Result_upd" BEFORE UPDATE ON "Result" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Result_ins_fn"();

CREATE FUNCTION "tg_guard_Student_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."classId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId"))
  OR (NEW."routeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Route" R WHERE R."id" = NEW."routeId" AND R."schoolId" = NEW."schoolId"))
  OR (NEW."guardianId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."guardianId" AND U."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Student references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Student_ins" BEFORE INSERT ON "Student" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Student_ins_fn"();
CREATE TRIGGER "tg_guard_Student_upd" BEFORE UPDATE ON "Student" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Student_ins_fn"();

CREATE FUNCTION "tg_guard_SM_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: StudyMaterial references another school''s subject';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_SM_ins" BEFORE INSERT ON "StudyMaterial" FOR EACH ROW EXECUTE FUNCTION "tg_guard_SM_ins_fn"();
CREATE TRIGGER "tg_guard_SM_upd" BEFORE UPDATE ON "StudyMaterial" FOR EACH ROW EXECUTE FUNCTION "tg_guard_SM_ins_fn"();

CREATE FUNCTION "tg_guard_SMT_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "StudyMaterial" M, "Student" S WHERE M."id" = NEW."studyMaterialId" AND S."id" = NEW."studentId" AND S."schoolId" = M."schoolId") THEN
    RAISE EXCEPTION 'tenant-guard: StudyMaterialTarget links rows across schools';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_SMT_ins" BEFORE INSERT ON "StudyMaterialTarget" FOR EACH ROW EXECUTE FUNCTION "tg_guard_SMT_ins_fn"();
CREATE TRIGGER "tg_guard_SMT_upd" BEFORE UPDATE ON "StudyMaterialTarget" FOR EACH ROW EXECUTE FUNCTION "tg_guard_SMT_ins_fn"();

CREATE FUNCTION "tg_guard_ST_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Student" S WHERE S."id" = NEW."studentId" AND S."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" SU WHERE SU."id" = NEW."subjectId" AND SU."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: StudyTask references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_ST_ins" BEFORE INSERT ON "StudyTask" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ST_ins_fn"();
CREATE TRIGGER "tg_guard_ST_upd" BEFORE UPDATE ON "StudyTask" FOR EACH ROW EXECUTE FUNCTION "tg_guard_ST_ins_fn"();

CREATE FUNCTION "tg_guard_Timetable_ins_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Class" C WHERE C."id" = NEW."classId" AND C."schoolId" = NEW."schoolId")
  OR (NEW."subjectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Subject" S WHERE S."id" = NEW."subjectId" AND S."schoolId" = NEW."schoolId"))
  OR (NEW."teacherUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" U WHERE U."id" = NEW."teacherUserId" AND U."schoolId" = NEW."schoolId")) THEN
    RAISE EXCEPTION 'tenant-guard: Timetable references another school''s row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_guard_Timetable_ins" BEFORE INSERT ON "Timetable" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Timetable_ins_fn"();
CREATE TRIGGER "tg_guard_Timetable_upd" BEFORE UPDATE ON "Timetable" FOR EACH ROW EXECUTE FUNCTION "tg_guard_Timetable_ins_fn"();

-- ═══ 2. SINGLE-ROW BOUNDS → NATIVE CHECK CONSTRAINTS ═══
-- (identical predicates to the SQLite tg_bound_* triggers: Fee.paid within
-- 0..amount, positive money, LibraryBook availability, Result/Timetable bounds)
ALTER TABLE "Fee" ADD CONSTRAINT "fee_paid_bounds_chk" CHECK ("paid" >= 0 AND "paid" <= "amount");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive_chk" CHECK ("amount" > 0);
ALTER TABLE "FeeTransaction" ADD CONSTRAINT "feetransaction_amount_positive_chk" CHECK ("amount" > 0);
ALTER TABLE "LibraryBook" ADD CONSTRAINT "librarybook_available_bounds_chk" CHECK ("available" >= 0 AND "available" <= "copies");
ALTER TABLE "Result" ADD CONSTRAINT "result_marks_bounds_chk" CHECK ("marks" >= 0 AND "marks" <= "totalMarks");
ALTER TABLE "Timetable" ADD CONSTRAINT "timetable_period_positive_chk" CHECK ("period" >= 1);
ALTER TABLE "ExamMark" ADD CONSTRAINT "exammark_marksobtained_nonneg_chk" CHECK ("marksObtained" IS NULL OR "marksObtained" >= 0);
ALTER TABLE "ExamMark" ADD CONSTRAINT "exammark_gracemarks_nonneg_chk" CHECK ("graceMarks" >= 0);

-- ═══ 3. CROSS-TABLE BOUND: ExamMark.marksObtained ≤ ExamSubjectConfig.maxMarks ═══

CREATE FUNCTION "tg_bound_ExamMark_fn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."marksObtained" IS NOT NULL AND (NEW."marksObtained" < 0 OR NEW."marksObtained" >
    COALESCE((SELECT CFG."maxMarks" FROM "ExamSubjectConfig" CFG WHERE CFG."examId" = NEW."examId" AND CFG."classId" = NEW."classId" AND CFG."subjectId" = NEW."subjectId"), 2147483647)))
  OR NEW."graceMarks" < 0 THEN
    RAISE EXCEPTION 'bound-guard: ExamMark.marksObtained outside 0..maxMarks (or negative grace)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tg_bound_ExamMark_ins" BEFORE INSERT ON "ExamMark" FOR EACH ROW EXECUTE FUNCTION "tg_bound_ExamMark_fn"();
CREATE TRIGGER "tg_bound_ExamMark_upd" BEFORE UPDATE ON "ExamMark" FOR EACH ROW EXECUTE FUNCTION "tg_bound_ExamMark_fn"();
