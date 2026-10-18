-- CreateEnum
CREATE TYPE "BackupScope" AS ENUM ('DB', 'DB_AND_FILES');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_RESTORE_SAFETY');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "scope" "BackupScope" NOT NULL,
    "trigger" "BackupTrigger" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "sizeBytesEncrypted" BIGINT,
    "checksumSha256" TEXT,
    "ivHex" TEXT,
    "authTagHex" TEXT,
    "wrappedDekHex" TEXT,
    "algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "appVersion" TEXT,
    "schemaMigrationName" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_records_createdAt_idx" ON "backup_records"("createdAt");

-- CreateIndex
CREATE INDEX "backup_records_status_idx" ON "backup_records"("status");

-- AddForeignKey
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
