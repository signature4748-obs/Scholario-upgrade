/*
 * TENANT-SCOPED schoolId INDEXES — HIGH audit fix (11 tables).
 *
 * Every tenant-owned table must be reachable by its schoolId through an
 * index (the isolation filter `where: { schoolId }` prefixes nearly
 * every query; without a leading-column index these degrade to
 * sequential scans that grow with the whole multi-tenant table).
 *
 * Derived from the live catalog: tables with a "schoolId" column but NO
 * index whose leading column is "schoolId" (cross-checked against
 * pg_indexes — includes the raw-SQL indexes no schema-diff can see):
 *
 *   Assignment, Driver, ExamPaper, HomeworkAuditLog, HomeworkSubmission,
 *   HomeworkSurvey, ParentGrievance, QuestionBank, Route, SchoolEvent,
 *   Vehicle
 *
 * Naming/convention follows 20261002000200_8c_hot_path_indexes
 * (<Table>_schoolId_idx). Idempotent guards keep it safe on any
 * partial state.
 */
CREATE INDEX IF NOT EXISTS "Assignment_schoolId_idx" ON "Assignment"("schoolId");
CREATE INDEX IF NOT EXISTS "Driver_schoolId_idx" ON "Driver"("schoolId");
CREATE INDEX IF NOT EXISTS "ExamPaper_schoolId_idx" ON "ExamPaper"("schoolId");
CREATE INDEX IF NOT EXISTS "HomeworkAuditLog_schoolId_idx" ON "HomeworkAuditLog"("schoolId");
CREATE INDEX IF NOT EXISTS "HomeworkSubmission_schoolId_idx" ON "HomeworkSubmission"("schoolId");
CREATE INDEX IF NOT EXISTS "HomeworkSurvey_schoolId_idx" ON "HomeworkSurvey"("schoolId");
CREATE INDEX IF NOT EXISTS "ParentGrievance_schoolId_idx" ON "ParentGrievance"("schoolId");
CREATE INDEX IF NOT EXISTS "QuestionBank_schoolId_idx" ON "QuestionBank"("schoolId");
CREATE INDEX IF NOT EXISTS "Route_schoolId_idx" ON "Route"("schoolId");
CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_idx" ON "SchoolEvent"("schoolId");
CREATE INDEX IF NOT EXISTS "Vehicle_schoolId_idx" ON "Vehicle"("schoolId");
