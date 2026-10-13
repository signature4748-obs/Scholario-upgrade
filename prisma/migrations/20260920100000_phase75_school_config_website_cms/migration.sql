-- PHASE 7.5 — School configuration source of truth + Website CMS
-- Additive only: no data loss, no destructive changes.

-- 1. School identity extensions (canonical, server-side)
ALTER TABLE "School" ADD COLUMN "shortName" TEXT;
ALTER TABLE "School" ADD COLUMN "tagline" TEXT;
ALTER TABLE "School" ADD COLUMN "affiliation" TEXT;
ALTER TABLE "School" ADD COLUMN "website" TEXT;
ALTER TABLE "School" ADD COLUMN "principalName" TEXT;
ALTER TABLE "School" ADD COLUMN "established" TEXT;
ALTER TABLE "School" ADD COLUMN "faviconUrl" TEXT;

-- 2. School configuration JSON + Website CMS document JSON
ALTER TABLE "School" ADD COLUMN "settings" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "School" ADD COLUMN "websiteContent" TEXT NOT NULL DEFAULT '{}';

-- 3. Announcement lifecycle (editorial state + image + audit trail)
-- Columns mirror the schema exactly: Prisma's @updatedAt keeps NO DB-side
-- default (the client always writes the value). SQLite permits ADD COLUMN
-- NOT NULL without a default only while the table is empty — true on every
-- fresh `migrate deploy` (the only apply path for this lineage; data-bearing
-- sandboxes evolve via `db push`), so no epoch-default + backfill is needed
-- (the previous epoch DEFAULT here was the Gate-3b schema-drift source).
-- (schoolId, createdAt) is declared by the schema but already created by the
-- integrity_constraints migration, so nothing to add here. The old
-- (schoolId, status) index is retired: the schema does not declare it (it
-- existed only in this hand-authored migration, never in a db-push-built
-- database).
ALTER TABLE "Notification" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE "Notification" ADD COLUMN "imageId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "Notification" ADD COLUMN "updatedAt" DATETIME NOT NULL;

-- 4. Website gallery (albums + images, tenant-scoped)
CREATE TABLE "GalleryAlbum" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GalleryAlbum_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GalleryAlbum_schoolId_title_key" ON "GalleryAlbum"("schoolId", "title");

CREATE TABLE "GalleryImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "albumId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GalleryImage_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "GalleryAlbum" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GalleryImage_albumId_order_idx" ON "GalleryImage"("albumId", "order");
