-- TQA-9 (Teacher Production QA) — canonical Room relation on Timetable +
-- room double-booking guard.
--
-- ROOT CAUSE: Timetable.room was free text with no relation to Room and no
-- conflict detection — two classes could be published into the same room at
-- the same day/period and nothing rejected it (class/teacher conflicts were
-- already DB-enforced).
--
-- This migration is ADDITIVE and PRESERVES every existing row:
--   · new nullable roomId column (display `room` text stays untouched);
--   · backfill links a cell to a Room ONLY when the free-text display name
--     exactly matches (case-insensitive trim) an ACTIVE room of the same
--     school — no invented links, no silent renames;
--   · FK mirrors Class.roomRef semantics (SetNull — a deleted room keeps
--     the historical display text readable);
--   · unique (schoolId, roomId, day, period) is the room double-booking
--     guard (NULL roomId rows are distinct in Postgres, exactly like the
--     teacherUserId key).

-- AlterTable
ALTER TABLE "Timetable" ADD COLUMN "roomId" TEXT;

-- Backfill (data-preserving; idempotent)
UPDATE "Timetable" AS t
SET "roomId" = r."id"
FROM "Room" AS r
WHERE r."schoolId" = t."schoolId"
  AND t."roomId" IS NULL
  AND t."room" IS NOT NULL
  AND lower(btrim(t."room")) = lower(btrim(r."name"));

-- CreateIndex
CREATE UNIQUE INDEX "Timetable_schoolId_roomId_day_period_key" ON "Timetable"("schoolId", "roomId", "day", "period");

-- AddForeignKey
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
