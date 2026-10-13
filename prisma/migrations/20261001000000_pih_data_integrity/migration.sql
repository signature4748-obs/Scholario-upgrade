-- PIH-4b — data-integrity repair (data-only; no schema change)
--
-- 1. Attendance: dedup same-calendar-day rows, then anchor every date to
--    midnight UTC (the canonical day key; schema unique is ms-exact).
-- 2. Timetable: backfill teacherUserId from the unique same-school
--    name-matched User (guarded so the (schoolId, teacherUserId, day,
--    period) unique can never be violated).
-- 3. Fee ledger parity: FeeTransaction rows for legacy Payment rows that
--    never got one (seeds wrote Fee.paid/Payment without the canonical
--    ledger) — receipt numbers in the canonical SCH-YYYY-NNNNNN scheme,
--    sequential per school-year, continuing after the existing max.

-- ── 1a. Attendance dedup ────────────────────────────────────────────────
-- For every (student, calendar-day) group keep ONLY the latest row
-- (max date; tie-break max id) and delete the others. Must run BEFORE
-- the midnight rounding below: rounding first would collide the surviving
-- rows on the ms-exact @@unique(studentId, date).
DELETE FROM "Attendance" AS a
WHERE EXISTS (
  SELECT 1
  FROM "Attendance" b
  WHERE b."studentId" = a."studentId"
    AND date(b."date" / 1000, 'unixepoch') = date(a."date" / 1000, 'unixepoch')
    AND (b."date" > a."date" OR (b."date" = a."date" AND b."id" > a."id"))
);

-- ── 1b. Attendance day anchor ───────────────────────────────────────────
-- Round every date to midnight UTC: (date/86400000)*86400000 (integer
-- division — epoch-ms is a positive INTEGER in this lineage). After the
-- dedup above there is exactly one row per (student, day), so the unique
-- key cannot collide mid-round.
UPDATE "Attendance"
SET "date" = ("date" / 86400000) * 86400000
WHERE "date" % 86400000 != 0;

-- ── 2. Timetable.teacherUserId backfill ─────────────────────────────────
-- Where NULL, set the matching User id IF exactly one same-school User
-- matches lower(name) = lower(teacherName). Extra guard: skip rows whose
-- resolved teacher already occupies (or would occupy — a sibling NULL
-- name-matched row) the same (school, day, period) cell, because the
-- @@unique([schoolId, teacherUserId, day, period]) key must hold after
-- the backfill (NULL-keyed legacy rows bypass it today).
UPDATE "Timetable"
SET "teacherUserId" = (
  SELECT "User"."id"
  FROM "User"
  WHERE "User"."schoolId" = "Timetable"."schoolId"
    AND lower("User"."name") = lower("Timetable"."teacherName")
)
WHERE "teacherUserId" IS NULL
  AND "teacherName" IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM "User"
    WHERE "User"."schoolId" = "Timetable"."schoolId"
      AND lower("User"."name") = lower("Timetable"."teacherName")
  ) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "Timetable" t2
    JOIN "User" u2
      ON u2."schoolId" = "Timetable"."schoolId"
     AND lower(u2."name") = lower("Timetable"."teacherName")
    WHERE t2."schoolId" = "Timetable"."schoolId"
      AND t2."day" = "Timetable"."day"
      AND t2."period" = "Timetable"."period"
      AND t2."id" != "Timetable"."id"
      AND (
        t2."teacherUserId" = u2."id"
        OR (
          t2."teacherUserId" IS NULL
          AND t2."teacherName" IS NOT NULL
          AND lower(t2."teacherName") = lower("Timetable"."teacherName")
        )
      )
  );

-- ── 3. Fee ledger parity backfill ───────────────────────────────────────
-- One canonical SUCCESS FeeTransaction per legacy Payment row that has no
-- matching FeeTransaction (matched by feeId + amount; Payment carries no
-- studentId, so feeId is the only ledger linkage — every orphan payment in
-- this lineage has one). Receipt numbers use the canonical scheme
-- SCH-YYYY-NNNNNN, sequential per school-year, continuing after the
-- existing max for that school+year. Safe to re-run (WHERE NOT EXISTS).
INSERT INTO "FeeTransaction" (
  "id", "schoolId", "studentId", "studentName", "className", "feeHeadName",
  "amount", "method", "status", "source", "feeId",
  "collectedByName", "collectedAt", "verifiedAt",
  "receiptNo", "note", "createdAt", "updatedAt"
)
SELECT
  'pih4b-' || p."id",
  p."schoolId",
  f."studentId",
  (
    SELECT "User"."name"
    FROM "User"
    JOIN "Student" ON "Student"."userId" = "User"."id"
    WHERE "Student"."id" = f."studentId"
  ),
  (
    SELECT "Class"."name"
    FROM "Student"
    JOIN "Class" ON "Class"."id" = "Student"."classId"
    WHERE "Student"."id" = f."studentId"
  ),
  f."title",
  p."amount",
  CASE upper(p."method")
    WHEN 'NETBANKING' THEN 'NET_BANKING'
    WHEN 'NET BANKING' THEN 'NET_BANKING'
    WHEN 'BANKTRANSFER' THEN 'BANK_TRANSFER'
    WHEN 'BANK TRANSFER' THEN 'BANK_TRANSFER'
    ELSE COALESCE(upper(p."method"), 'CASH')
  END,
  'SUCCESS',
  'SCHOOL_OFFICE',
  p."feeId",
  'School Office',
  p."createdAt",
  p."createdAt",
  'SCH-' || strftime('%Y', p."createdAt" / 1000, 'unixepoch') || '-'
    || printf(
      '%06d',
      COALESCE(
        (
          SELECT MAX(CAST(substr(t2."receiptNo", 10) AS INTEGER))
          FROM "FeeTransaction" t2
          WHERE t2."schoolId" = p."schoolId"
            AND t2."receiptNo" LIKE 'SCH-'
              || strftime('%Y', p."createdAt" / 1000, 'unixepoch') || '-%'
        ),
        0
      )
      + ROW_NUMBER() OVER (
        PARTITION BY p."schoolId", strftime('%Y', p."createdAt" / 1000, 'unixepoch')
        ORDER BY p."createdAt", p."id"
      )
    ),
  'Ledger parity backfill (PIH-4b) — canonical mirror for legacy Payment row',
  p."createdAt",
  p."createdAt"
FROM "Payment" p
JOIN "Fee" f ON f."id" = p."feeId"
WHERE p."feeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "FeeTransaction" t
    WHERE t."schoolId" = p."schoolId"
      AND t."feeId" = p."feeId"
      AND t."status" = 'SUCCESS'
      AND abs(t."amount" - p."amount") < 0.001
  );
