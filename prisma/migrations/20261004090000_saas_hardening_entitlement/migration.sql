-- DropIndex
DROP INDEX "Class_name_trgm";

-- DropIndex
DROP INDEX "Fee_title_trgm";

-- DropIndex
DROP INDEX "FlashcardDeck_name_trgm";

-- DropIndex
DROP INDEX "GrowthEvent_reason_trgm";

-- DropIndex
DROP INDEX "GrowthRule_label_trgm";

-- DropIndex
DROP INDEX "Message_body_trgm";

-- DropIndex
DROP INDEX "Message_subject_trgm";

-- DropIndex
DROP INDEX "Notification_message_trgm";

-- DropIndex
DROP INDEX "Notification_title_trgm";

-- DropIndex
DROP INDEX "ParentMessage_body_trgm";

-- DropIndex
DROP INDEX "PlatformAuditLog_action_trgm";

-- DropIndex
DROP INDEX "PlatformAuditLog_reason_trgm";

-- DropIndex
DROP INDEX "School_code_trgm";

-- DropIndex
DROP INDEX "School_domain_trgm";

-- DropIndex
DROP INDEX "School_name_trgm";

-- DropIndex
DROP INDEX "School_slug_trgm";

-- DropIndex
DROP INDEX "Student_admissionNo_trgm";

-- DropIndex
DROP INDEX "StudyGroup_name_trgm";

-- DropIndex
DROP INDEX "StudyMaterial_description_trgm";

-- DropIndex
DROP INDEX "StudyMaterial_title_trgm";

-- DropIndex
DROP INDEX "Teacher_employeeId_trgm";

-- DropIndex
DROP INDEX "TeacherFollowUp_reason_trgm";

-- DropIndex
DROP INDEX "Timetable_teacherName_trgm";

-- DropIndex
DROP INDEX "User_name_trgm";

-- CreateTable
CREATE TABLE "SchoolSubscription" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'STANDARD',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "overrideStatus" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "mode" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "periodMonths" INTEGER NOT NULL DEFAULT 12,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'VERIFIED',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusAfter" TEXT,
    "periodEndAfter" TIMESTAMP(3),
    "receiptNo" TEXT,
    "subscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteNotice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTICE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "attachmentFileId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAdmission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "session" TEXT,
    "classesAccepting" TEXT NOT NULL DEFAULT '[]',
    "openingDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "noticeTitle" TEXT,
    "noticeBody" TEXT,
    "applicationUrl" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteSocialLink" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteSocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteMedia" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "title" TEXT,
    "altText" TEXT,
    "usage" TEXT NOT NULL DEFAULT 'LIBRARY',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolProfileChangeRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" TEXT,
    "requestedValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolProfileChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolPaymentGateway" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "publicKeyId" TEXT,
    "secretKeyCipher" TEXT,
    "secretKeyNonce" TEXT,
    "webhookSecretCipher" TEXT,
    "webhookSecretNonce" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "configuredById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSubscription_schoolId_key" ON "SchoolSubscription"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_receiptNo_key" ON "PlatformPayment"("receiptNo");

-- CreateIndex
CREATE INDEX "PlatformPayment_schoolId_paymentDate_idx" ON "PlatformPayment"("schoolId", "paymentDate");

-- CreateIndex
CREATE INDEX "PlatformPayment_recordedById_idx" ON "PlatformPayment"("recordedById");

-- CreateIndex
CREATE INDEX "WebsiteNotice_schoolId_status_idx" ON "WebsiteNotice"("schoolId", "status");

-- CreateIndex
CREATE INDEX "WebsiteNotice_schoolId_kind_pinned_publishAt_idx" ON "WebsiteNotice"("schoolId", "kind", "pinned", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteAdmission_schoolId_key" ON "WebsiteAdmission"("schoolId");

-- CreateIndex
CREATE INDEX "WebsiteSocialLink_schoolId_order_idx" ON "WebsiteSocialLink"("schoolId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSocialLink_schoolId_platform_key" ON "WebsiteSocialLink"("schoolId", "platform");

-- CreateIndex
CREATE INDEX "WebsiteMedia_schoolId_usage_idx" ON "WebsiteMedia"("schoolId", "usage");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteMedia_schoolId_fileId_key" ON "WebsiteMedia"("schoolId", "fileId");

-- CreateIndex
CREATE INDEX "SchoolProfileChangeRequest_schoolId_status_idx" ON "SchoolProfileChangeRequest"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPaymentGateway_schoolId_key" ON "SchoolPaymentGateway"("schoolId");

-- AddForeignKey
ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "SchoolSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteNotice" ADD CONSTRAINT "WebsiteNotice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAdmission" ADD CONSTRAINT "WebsiteAdmission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteSocialLink" ADD CONSTRAINT "WebsiteSocialLink_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteMedia" ADD CONSTRAINT "WebsiteMedia_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolProfileChangeRequest" ADD CONSTRAINT "SchoolProfileChangeRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentGateway" ADD CONSTRAINT "SchoolPaymentGateway_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

