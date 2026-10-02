/**
 * PHASE 3 — Database Integrity Auditor (read-only).
 * PHASE 8C FIX — PostgreSQL identifier correctness: every raw query now
 * double-quotes table AND column identifiers (Prisma maps models to quoted
 * PascalCase tables / camelCase columns; unquoted SQL folds to lowercase in
 * PG and every probe failed with `relation "student" does not exist` on
 * 8A+ databases, including Supabase production). Query errors are now
 * LOUD (banner + exit 2) — a diagnostic that silently swallows broken SQL
 * is worse than no diagnostic.
 *
 * Runs against the live PostgreSQL DB and reports:
 *   1. candidate-unique duplicates        (would block a new constraint)
 *   2. cross-school FK violations         (tenant isolation at the row level)
 *   3. dangling plain-string references   (no FK, no guarantee)
 *   4. data-bound violations              (marks > max, paid > amount, ...)
 *   5. row counts                         (scale baseline for docs)
 *
 * Usage: bun run db:audit   (or: bun prisma/audit-db-integrity.ts)
 * Exit 0 = report produced, zero query errors (rows may still be flagged —
 * this is a diagnostic, not a gate; the automated GATE lives in
 * tests/security/database-integrity.test.ts).
 * Exit 2 = one or more probes FAILED to execute — the report is incomplete.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Section = { title: string; rows: unknown[] };
let sqlErrors = 0;

async function raw<T>(sql: string): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(sql);
}

async function q(sql: string): Promise<unknown[]> {
  try {
    return await raw(sql);
  } catch (err) {
    sqlErrors += 1;
    return [{ error: String(err) }];
  }
}

async function main() {
  const sections: Section[] = [];

  // ── 1. Candidate-unique duplicates ──────────────────────────────────
  const dupChecks: Array<[string, string]> = [
    ["Student (schoolId, admissionNo)", `SELECT "schoolId", "admissionNo", COUNT(*) n FROM "Student" WHERE "admissionNo" IS NOT NULL GROUP BY "schoolId", "admissionNo" HAVING COUNT(*) > 1`],
    ["Student (schoolId, classId, rollNo)", `SELECT "schoolId", "classId", "rollNo", COUNT(*) n FROM "Student" WHERE "rollNo" IS NOT NULL AND "classId" IS NOT NULL GROUP BY "schoolId", "classId", "rollNo" HAVING COUNT(*) > 1`],
    ["Class (schoolId, name, section)", `SELECT "schoolId", "name", "section", COUNT(*) n FROM "Class" GROUP BY "schoolId", "name", "section" HAVING COUNT(*) > 1`],
    ["Class (schoolId, name) — info only", `SELECT "schoolId", "name", COUNT(*) n FROM "Class" GROUP BY "schoolId", "name" HAVING COUNT(*) > 1`],
    ["Exam (schoolId, name, session)", `SELECT "schoolId", "name", "session", COUNT(*) n FROM "Exam" GROUP BY "schoolId", "name", "session" HAVING COUNT(*) > 1`],
    ["Subject (schoolId, code) — enforced already", `SELECT "schoolId", "code", COUNT(*) n FROM "Subject" WHERE "code" IS NOT NULL GROUP BY "schoolId", "code" HAVING COUNT(*) > 1`],
    ["Subject null codes — info (unique bypass)", `SELECT "schoolId", COUNT(*) n FROM "Subject" WHERE "code" IS NULL GROUP BY "schoolId"`],
    ["Timetable class-slot conflict (schoolId, classId, day, period)", `SELECT "schoolId", "classId", "day", "period", COUNT(*) n FROM "Timetable" GROUP BY "schoolId", "classId", "day", "period" HAVING COUNT(*) > 1`],
    ["Timetable teacher double-book (schoolId, teacherUserId, day, period)", `SELECT "schoolId", "teacherUserId", "day", "period", COUNT(*) n FROM "Timetable" WHERE "teacherUserId" IS NOT NULL GROUP BY "schoolId", "teacherUserId", "day", "period" HAVING COUNT(*) > 1`],
    ["Result (studentId, examId, subjectId)", `SELECT "studentId", "examId", "subjectId", COUNT(*) n FROM "Result" GROUP BY "studentId", "examId", "subjectId" HAVING COUNT(*) > 1`],
    ["FeeTransaction (schoolId, receiptNo)", `SELECT "schoolId", "receiptNo", COUNT(*) n FROM "FeeTransaction" WHERE "receiptNo" IS NOT NULL GROUP BY "schoolId", "receiptNo" HAVING COUNT(*) > 1`],
    ["FeeTransaction (schoolId, referenceNumber)", `SELECT "schoolId", "referenceNumber", COUNT(*) n FROM "FeeTransaction" WHERE "referenceNumber" IS NOT NULL GROUP BY "schoolId", "referenceNumber" HAVING COUNT(*) > 1`],
    ["Payment (transactionId) — gateway ref dedupe", `SELECT "transactionId", COUNT(*) n FROM "Payment" WHERE "transactionId" IS NOT NULL GROUP BY "transactionId" HAVING COUNT(*) > 1`],
    ["Reconciliation (transactionId, settlementId)", `SELECT "transactionId", "settlementId", COUNT(*) n FROM "Reconciliation" GROUP BY "transactionId", "settlementId" HAVING COUNT(*) > 1`],
    ["LibraryBook (schoolId, isbn)", `SELECT "schoolId", "isbn", COUNT(*) n FROM "LibraryBook" WHERE "isbn" IS NOT NULL GROUP BY "schoolId", "isbn" HAVING COUNT(*) > 1`],
    ["BookIssue active double-issue (bookId, studentId)", `SELECT "bookId", "studentId", COUNT(*) n FROM "BookIssue" WHERE "status" = 'ISSUED' AND "studentId" IS NOT NULL GROUP BY "bookId", "studentId" HAVING COUNT(*) > 1`],
    ["Fee (schoolId, studentId, title) — business-key info", `SELECT "schoolId", "studentId", "title", COUNT(*) n FROM "Fee" GROUP BY "schoolId", "studentId", "title" HAVING COUNT(*) > 1`],
  ];
  for (const [label, sql] of dupChecks) {
    const rows = await q(sql);
    sections.push({ title: `DUP? ${label}`, rows });
  }

  // ── 2. Cross-school FK violations (defense-in-depth check) ──────────
  const xssChecks: Array<[string, string]> = [
    ["Student.classId vs school", `SELECT s."id" FROM "Student" s JOIN "Class" c ON s."classId" = c."id" WHERE s."schoolId" != c."schoolId"`],
    ["Student.routeId vs school", `SELECT s."id" FROM "Student" s JOIN "Route" r ON s."routeId" = r."id" WHERE s."schoolId" != r."schoolId"`],
    ["ClassSubjectAssignment class/subject school", `SELECT a."id" FROM "ClassSubjectAssignment" a JOIN "Class" c ON a."classId" = c."id" JOIN "Subject" su ON a."subjectId" = su."id" WHERE a."schoolId" != c."schoolId" OR a."schoolId" != su."schoolId"`],
    ["ClassSubjectAssignment teacherUserId school", `SELECT a."id" FROM "ClassSubjectAssignment" a JOIN "User" u ON a."teacherUserId" = u."id" WHERE u."schoolId" IS NULL OR u."schoolId" != a."schoolId"`],
    ["ExamMark parents school", `SELECT m."id" FROM "ExamMark" m JOIN "Exam" e ON m."examId" = e."id" JOIN "Student" st ON m."studentId" = st."id" JOIN "Class" c ON m."classId" = c."id" JOIN "Subject" su ON m."subjectId" = su."id" WHERE st."schoolId" != e."schoolId" OR c."schoolId" != e."schoolId" OR su."schoolId" != e."schoolId"`],
    ["ExamScheduleItem parents school", `SELECT i."id" FROM "ExamScheduleItem" i JOIN "Exam" e ON i."examId" = e."id" JOIN "Class" c ON i."classId" = c."id" JOIN "Subject" su ON i."subjectId" = su."id" WHERE c."schoolId" != e."schoolId" OR su."schoolId" != e."schoolId"`],
    ["ExamSubjectConfig parents school", `SELECT x."id" FROM "ExamSubjectConfig" x JOIN "Exam" e ON x."examId" = e."id" JOIN "Class" c ON x."classId" = c."id" JOIN "Subject" su ON x."subjectId" = su."id" WHERE c."schoolId" != e."schoolId" OR su."schoolId" != e."schoolId"`],
    ["ExamClass parents school", `SELECT x."id" FROM "ExamClass" x JOIN "Exam" e ON x."examId" = e."id" JOIN "Class" c ON x."classId" = c."id" WHERE c."schoolId" != e."schoolId"`],
    ["Exam.classId vs school", `SELECT e."id" FROM "Exam" e JOIN "Class" c ON e."classId" = c."id" WHERE c."schoolId" != e."schoolId"`],
    ["Attendance student/class school", `SELECT a."id" FROM "Attendance" a JOIN "Student" s ON a."studentId" = s."id" LEFT JOIN "Class" c ON a."classId" = c."id" WHERE s."schoolId" != a."schoolId" OR (a."classId" IS NOT NULL AND c."schoolId" != a."schoolId")`],
    ["AttendanceDraft class school", `SELECT d."id" FROM "AttendanceDraft" d JOIN "Class" c ON d."classId" = c."id" WHERE c."schoolId" != d."schoolId"`],
    ["AttendanceAuditLog student school", `SELECT l."id" FROM "AttendanceAuditLog" l JOIN "Student" s ON l."studentId" = s."id" WHERE s."schoolId" != l."schoolId"`],
    ["Timetable class/subject/teacher school", `SELECT t."id" FROM "Timetable" t JOIN "Class" c ON t."classId" = c."id" LEFT JOIN "Subject" su ON t."subjectId" = su."id" LEFT JOIN "User" u ON t."teacherUserId" = u."id" WHERE c."schoolId" != t."schoolId" OR (t."subjectId" IS NOT NULL AND su."schoolId" != t."schoolId") OR (t."teacherUserId" IS NOT NULL AND (u."schoolId" IS NULL OR u."schoolId" != t."schoolId"))`],
    ["Fee student school", `SELECT f."id" FROM "Fee" f JOIN "Student" s ON f."studentId" = s."id" WHERE s."schoolId" != f."schoolId"`],
    ["FeeTransaction student/fee/structure school (plain-string refs)", `SELECT t."id", t."studentId", t."feeId", t."structureId" FROM "FeeTransaction" t LEFT JOIN "Student" s ON t."studentId" = s."id" LEFT JOIN "Fee" f ON t."feeId" = f."id" LEFT JOIN "FeeStructure" st ON t."structureId" = st."id" WHERE (t."studentId" IS NOT NULL AND (s."id" IS NULL OR s."schoolId" != t."schoolId")) OR (t."feeId" IS NOT NULL AND (f."id" IS NULL OR f."schoolId" != t."schoolId")) OR (t."structureId" IS NOT NULL AND (st."id" IS NULL OR st."schoolId" != t."schoolId"))`],
    ["BookIssue book vs student school", `SELECT b."id" FROM "BookIssue" b JOIN "LibraryBook" lb ON b."bookId" = lb."id" LEFT JOIN "Student" s ON b."studentId" = s."id" WHERE s."id" IS NOT NULL AND s."schoolId" != lb."schoolId"`],
    ["Result parents school", `SELECT r."id" FROM "Result" r JOIN "Student" s ON r."studentId" = s."id" JOIN "Exam" e ON r."examId" = e."id" JOIN "Subject" su ON r."subjectId" = su."id" WHERE s."schoolId" != e."schoolId" OR su."schoolId" != e."schoolId"`],
    ["Homework class/subject school", `SELECT h."id" FROM "Homework" h JOIN "Class" c ON h."classId" = c."id" LEFT JOIN "Subject" su ON h."subjectId" = su."id" WHERE c."schoolId" != h."schoolId" OR (h."subjectId" IS NOT NULL AND su."schoolId" != h."schoolId")`],
    ["StudyMaterial subjectId school (loose FK)", `SELECT m."id", m."subjectId" FROM "StudyMaterial" m LEFT JOIN "Subject" su ON m."subjectId" = su."id" WHERE m."subjectId" IS NOT NULL AND (su."id" IS NULL OR su."schoolId" != m."schoolId")`],
    ["QuestionBank subject/class school", `SELECT qb."id" FROM "QuestionBank" qb LEFT JOIN "Subject" su ON qb."subjectId" = su."id" LEFT JOIN "Class" c ON qb."classId" = c."id" WHERE (qb."subjectId" IS NOT NULL AND (su."id" IS NULL OR su."schoolId" != qb."schoolId")) OR (qb."classId" IS NOT NULL AND (c."id" IS NULL OR c."schoolId" != qb."schoolId"))`],
    ["GrowthEvent student school", `SELECT g."id" FROM "GrowthEvent" g JOIN "Student" s ON g."studentId" = s."id" WHERE s."schoolId" != g."schoolId"`],
    ["BehaviorRecord student school", `SELECT b."id" FROM "BehaviorRecord" b JOIN "Student" s ON b."studentId" = s."id" WHERE s."schoolId" != b."schoolId"`],
    ["ParentConversation teacher/parent/student school", `SELECT p."id" FROM "ParentConversation" p JOIN "User" t ON p."teacherId" = t."id" JOIN "User" pa ON p."parentId" = pa."id" JOIN "Student" s ON p."studentId" = s."id" WHERE t."schoolId" != p."schoolId" OR pa."schoolId" != p."schoolId" OR s."schoolId" != p."schoolId"`],
    ["Payment.feeId school (via Fee) — Payment has no schoolId column", `SELECT p."id", p."feeId" FROM "Payment" p JOIN "Fee" f ON p."feeId" = f."id" WHERE 1 = 0`],
  ];
  for (const [label, sql] of xssChecks) {
    const rows = await q(sql);
    sections.push({ title: `XSS? ${label}`, rows });
  }

  // ── 3. Dangling plain-string references ─────────────────────────────
  const dangling: Array<[string, string]> = [
    ["Payment rows with feeId NULL (orphan financial mirrors)", `SELECT p."id", p."amount", p."status" FROM "Payment" p WHERE p."feeId" IS NULL`],
    ["FeeTransaction.feeId dangling", `SELECT t."id" FROM "FeeTransaction" t LEFT JOIN "Fee" f ON t."feeId" = f."id" WHERE t."feeId" IS NOT NULL AND f."id" IS NULL`],
    ["FeeTransaction.studentId dangling", `SELECT t."id" FROM "FeeTransaction" t LEFT JOIN "Student" s ON t."studentId" = s."id" WHERE t."studentId" IS NOT NULL AND s."id" IS NULL`],
    ["FeeTransaction SUCCESS rows with feeId NULL (ledger-never-applied)", `SELECT t."id", t."amount", t."status" FROM "FeeTransaction" t WHERE t."status" = 'SUCCESS' AND t."feeId" IS NULL`],
  ];
  for (const [label, sql] of dangling) {
    const rows = await q(sql);
    sections.push({ title: `DANGLING? ${label}`, rows });
  }

  // ── 4. Data-bound violations ────────────────────────────────────────
  const boundChecks: Array<[string, string]> = [
    ["ExamMark.marksObtained > ExamSubjectConfig.maxMarks", `SELECT m."id", m."examId", m."marksObtained", c."maxMarks" FROM "ExamMark" m JOIN "ExamSubjectConfig" c ON c."examId" = m."examId" AND c."classId" = m."classId" AND c."subjectId" = m."subjectId" WHERE m."marksObtained" IS NOT NULL AND m."marksObtained" > c."maxMarks"`],
    ["ExamMark.marksObtained < 0", `SELECT m."id" FROM "ExamMark" m WHERE m."marksObtained" < 0`],
    ["ExamMark with NO config row (maxMarks unknown)", `SELECT m."id", m."examId", m."classId", m."subjectId" FROM "ExamMark" m WHERE NOT EXISTS (SELECT 1 FROM "ExamSubjectConfig" c WHERE c."examId" = m."examId" AND c."classId" = m."classId" AND c."subjectId" = m."subjectId")`],
    ["Result.marks > totalMarks", `SELECT r."id", r."marks", r."totalMarks" FROM "Result" r WHERE r."marks" > r."totalMarks"`],
    ["Fee.paid > amount", `SELECT f."id", f."paid", f."amount" FROM "Fee" f WHERE f."paid" > f."amount"`],
    ["Fee.paid < 0", `SELECT f."id" FROM "Fee" f WHERE f."paid" < 0`],
    ["Payment.amount <= 0", `SELECT p."id", p."amount" FROM "Payment" p WHERE p."amount" <= 0`],
    ["LibraryBook.available < 0", `SELECT b."id", b."available" FROM "LibraryBook" b WHERE b."available" < 0`],
    ["LibraryBook.available > copies", `SELECT b."id", b."available", b."copies" FROM "LibraryBook" b WHERE b."available" > b."copies"`],
    ["FeeTransaction.amount <= 0", `SELECT t."id", t."amount" FROM "FeeTransaction" t WHERE t."amount" <= 0`],
  ];
  for (const [label, sql] of boundChecks) {
    const rows = await q(sql);
    sections.push({ title: `BOUND? ${label}`, rows });
  }

  // ── 5. Row counts (scale baseline) ──────────────────────────────────
  const tables = [
    "School", "User", "Session", "Student", "Teacher", "Class", "Subject",
    "ClassSubjectAssignment", "Room", "Exam", "ExamMark", "Result",
    "Fee", "Payment", "FeeTransaction", "Settlement", "Reconciliation",
    "WebhookEvent", "Attendance", "AttendanceDraft", "AttendanceAuditLog",
    "Timetable", "Homework", "HomeworkSubmission", "Notification", "Message",
    "LibraryBook", "BookIssue", "ActivityLog", "StudyMaterial", "UploadedFile",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    try {
      const r = await raw<{ n: number }>(`SELECT COUNT(*) n FROM "${t}"`);
      counts[t] = Number(r[0]?.n ?? 0);
    } catch {
      sqlErrors += 1;
      counts[t] = -1;
    }
  }

  // ── report ──────────────────────────────────────────────────────────
  console.log("\n════════ SCHOLARIO-OS · DATABASE INTEGRITY AUDIT (read-only) ════════\n");
  let issues = 0;
  const show = (r: unknown) => JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  for (const s of sections) {
    const n = s.rows.length;
    const isError = n > 0 && !s.rows.some((r) => (r as { error?: string }).error);
    if (n > 0) issues += n;
    const tag = n === 0 ? "OK " : isError ? "!! " : "?E ";
    console.log(`${tag} ${s.title}  → ${n} row(s)`);
    if (n > 0 && n <= 12) {
      for (const r of s.rows) console.log(`      ${show(r)}`);
    } else if (n > 12) {
      for (const r of s.rows.slice(0, 5)) console.log(`      ${show(r)}`);
      console.log(`      … ${n - 5} more`);
    }
  }
  console.log("\n── row counts ──");
  for (const [t, n] of Object.entries(counts)) console.log(`   ${t.padEnd(24)} ${n}`);
  console.log(`\nTOTAL flagged rows: ${issues}`);
  console.log("(flagged rows = blockers/violations the Phase-3 migration must resolve)");
  if (sqlErrors > 0) {
    console.error(
      `\n⚠ AUDIT INCOMPLETE — ${sqlErrors} probe query(ies) FAILED to execute. ` +
        `The report above is NOT trustworthy until this is fixed (exit 2).`
    );
    process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error("audit failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
