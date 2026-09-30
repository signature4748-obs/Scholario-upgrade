-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isRoot" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlatformAdminSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "stepUpAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    CONSTRAINT "PlatformAdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PlatformPermission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "schoolId" TEXT,
    "reason" TEXT,
    "metadata" TEXT,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "SupportSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformAnnouncement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlatformSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "showDemoSchool" BOOLEAN NOT NULL DEFAULT true,
    "modules" TEXT NOT NULL DEFAULT '{}',
    "supportMaxDuration" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PlatformSetting" ("id", "showDemoSchool", "updatedAt") SELECT "id", "showDemoSchool", "updatedAt" FROM "PlatformSetting";
DROP TABLE "PlatformSetting";
ALTER TABLE "new_PlatformSetting" RENAME TO "PlatformSetting";
CREATE TABLE "new_School" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "domain" TEXT,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "themeColor" TEXT NOT NULL DEFAULT '#0f766e',
    "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "logoUrl" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "academicYear" TEXT,
    "board" TEXT NOT NULL DEFAULT 'CBSE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "featureFlags" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_School" ("academicYear", "accentColor", "address", "board", "city", "code", "createdAt", "domain", "email", "id", "isDemo", "logoUrl", "name", "phone", "plan", "slug", "status", "themeColor", "updatedAt") SELECT "academicYear", "accentColor", "address", "board", "city", "code", "createdAt", "domain", "email", "id", "isDemo", "logoUrl", "name", "phone", "plan", "slug", "status", "themeColor", "updatedAt" FROM "School";
DROP TABLE "School";
ALTER TABLE "new_School" RENAME TO "School";
CREATE UNIQUE INDEX "School_slug_key" ON "School"("slug");
CREATE UNIQUE INDEX "School_code_key" ON "School"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE INDEX "PlatformAdmin_status_idx" ON "PlatformAdmin"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdminSession_tokenHash_key" ON "PlatformAdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformAdminSession_adminId_idx" ON "PlatformAdminSession"("adminId");

-- CreateIndex
CREATE INDEX "PlatformAdminSession_expiresAt_idx" ON "PlatformAdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPermission_adminId_key_key" ON "PlatformPermission"("adminId", "key");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_adminId_createdAt_idx" ON "PlatformAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_schoolId_createdAt_idx" ON "PlatformAuditLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_action_idx" ON "PlatformAuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "SupportSession_tokenHash_key" ON "SupportSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SupportSession_adminId_idx" ON "SupportSession"("adminId");

-- CreateIndex
CREATE INDEX "SupportSession_schoolId_createdAt_idx" ON "SupportSession"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAnnouncement_createdAt_idx" ON "PlatformAnnouncement"("createdAt");

