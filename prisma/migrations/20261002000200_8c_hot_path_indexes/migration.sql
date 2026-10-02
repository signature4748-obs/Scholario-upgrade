/*
 * PHASE 8C — hot-path index audit outcome (mission §7: add from ACTUAL
 * query patterns, never blindly; document intent).
 *
 * The 8A/8B lineage already covers the §7 checklist: salary
 * (schoolId,teacherId,month,status uq + teacherId,month), messaging
 * (schoolId,recipientId/senderId,createdAt), audit logs
 * (ActivityLog schoolId,createdAt · PlatformAuditLog action/adminId/
 * schoolId,createdAt), email outbox (status,createdAt + dedupeKey),
 * tenant domains (hostname uq + status), sessions (tokenHash), receipt
 * numbers + payment idempotency (FK uq chain), attendance identity
 * (studentId,date uq). 81 FK-side columns remain unindexed — audited
 * against real query shapes; all but the two below are either covered by
 * leading-column composites for every query that actually runs, or are
 * rare admin/cascade scans that do not justify write amplification on
 * hot tables.
 *
 * The two genuine gaps (both added here):
 *
 *   1. Attendance(classId, date) — src/lib/class-attendance.ts queries
 *      `where: { classId, date: { gte, lt } }` WITHOUT schoolId (class
 *      identity IS the authorization scope there — the schoolId-leading
 *      composites cannot serve it). This is the attendance-taking hot
 *      path: every teacher, every class, every day.
 *
 *   2. Teacher(schoolId) — the Teacher table had NO schoolId index at
 *      all (only id/userId/trgm-employeeId). Every staff surface filters
 *      by schoolId: teacher rosters, homework teacher pickers, oversight
 *      counts, payroll views.
 *
 * Mirrors @@index declarations in prisma/schema.prisma (drift gate: the
 * names below are the exact Prisma-generated index names).
 */

-- Attendance: class-day sheet without schoolId scope (see class-attendance.ts).
CREATE INDEX "Attendance_classId_date_idx" ON "Attendance"("classId", date);

-- Teacher: every staff-list query is schoolId-filtered.
CREATE INDEX "Teacher_schoolId_idx" ON "Teacher"("schoolId");
