/*
 * CALENDAR DB WIRING — SchoolEvent.startTime.
 *
 * Additive-only: a nullable wall-clock 'HH:MM' string for calendar
 * events (null = all-day). Dates continue to live in startDate/endDate;
 * the display time is deliberately a STRING so a 09:00 event reads back
 * as 09:00 on every device of the tenant (timezone-free fact).
 *
 * Hand-authored per repo convention (see 20261004153000/20261004154000):
 * raw-SQL indexes are NOT declared in schema.prisma, so `prisma migrate
 * dev` must never be run against this repo — it would "reconcile" that
 * invisible drift by dropping the tenant/search indexes.
 */
-- AlterTable
ALTER TABLE "SchoolEvent" ADD COLUMN "startTime" TEXT;
