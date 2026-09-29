-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "feeId" TEXT,
    "amount" REAL NOT NULL,
    "method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "transactionId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "Fee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("schoolId", "amount", "createdAt", "feeId", "id", "method", "note", "status", "transactionId") SELECT COALESCE((SELECT "schoolId" FROM "Fee" WHERE "Fee"."id" = "Payment"."feeId"), ''), "amount", "createdAt", "feeId", "id", "method", "note", "status", "transactionId" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");
CREATE INDEX "Payment_schoolId_createdAt_idx" ON "Payment"("schoolId", "createdAt");
CREATE INDEX "Payment_feeId_idx" ON "Payment"("feeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ActivityLog_schoolId_createdAt_idx" ON "ActivityLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "Attendance_schoolId_classId_date_idx" ON "Attendance"("schoolId", "classId", "date");

-- CreateIndex
CREATE INDEX "Attendance_schoolId_date_idx" ON "Attendance"("schoolId", "date");

-- CreateIndex
CREATE INDEX "BookIssue_bookId_status_idx" ON "BookIssue"("bookId", "status");

-- CreateIndex
CREATE INDEX "BookIssue_studentId_status_idx" ON "BookIssue"("studentId", "status");

-- CreateIndex
CREATE INDEX "Class_schoolId_classTeacherId_idx" ON "Class"("schoolId", "classTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_schoolId_name_section_key" ON "Class"("schoolId", "name", "section");

-- CreateIndex
CREATE INDEX "ClassSubjectAssignment_schoolId_teacherUserId_isActive_idx" ON "ClassSubjectAssignment"("schoolId", "teacherUserId", "isActive");

-- CreateIndex
CREATE INDEX "Exam_schoolId_status_startDate_idx" ON "Exam"("schoolId", "status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_schoolId_name_session_key" ON "Exam"("schoolId", "name", "session");

-- CreateIndex
CREATE INDEX "ExamMark_classId_subjectId_idx" ON "ExamMark"("classId", "subjectId");

-- CreateIndex
CREATE INDEX "ExamMark_studentId_idx" ON "ExamMark"("studentId");

-- CreateIndex
CREATE INDEX "Fee_schoolId_status_idx" ON "Fee"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Fee_studentId_idx" ON "Fee"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeTransaction_schoolId_receiptNo_key" ON "FeeTransaction"("schoolId", "receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "FeeTransaction_schoolId_referenceNumber_key" ON "FeeTransaction"("schoolId", "referenceNumber");

-- CreateIndex
CREATE INDEX "Homework_schoolId_classId_dueDate_idx" ON "Homework"("schoolId", "classId", "dueDate");

-- CreateIndex
CREATE INDEX "LibraryBook_schoolId_idx" ON "LibraryBook"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBook_schoolId_isbn_key" ON "LibraryBook"("schoolId", "isbn");

-- CreateIndex
CREATE INDEX "Message_schoolId_recipientId_createdAt_idx" ON "Message"("schoolId", "recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_schoolId_senderId_createdAt_idx" ON "Message"("schoolId", "senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_schoolId_createdAt_idx" ON "Notification"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_transactionId_settlementId_key" ON "Reconciliation"("transactionId", "settlementId");

-- CreateIndex
CREATE INDEX "Result_examId_studentId_idx" ON "Result"("examId", "studentId");

-- CreateIndex
CREATE INDEX "Result_studentId_idx" ON "Result"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Result_studentId_examId_subjectId_key" ON "Result"("studentId", "examId", "subjectId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Student_schoolId_classId_idx" ON "Student"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "Student_guardianId_idx" ON "Student"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_schoolId_admissionNo_key" ON "Student"("schoolId", "admissionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Student_schoolId_classId_rollNo_key" ON "Student"("schoolId", "classId", "rollNo");

-- CreateIndex
CREATE INDEX "Timetable_schoolId_classId_day_idx" ON "Timetable"("schoolId", "classId", "day");

-- CreateIndex
CREATE INDEX "Timetable_schoolId_teacherUserId_day_idx" ON "Timetable"("schoolId", "teacherUserId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Timetable_schoolId_classId_day_period_key" ON "Timetable"("schoolId", "classId", "day", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Timetable_schoolId_teacherUserId_day_period_key" ON "Timetable"("schoolId", "teacherUserId", "day", "period");

-- CreateIndex
CREATE INDEX "User_schoolId_role_status_idx" ON "User"("schoolId", "role", "status");

