-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BackupTrigger" ADD VALUE 'PRE_MIGRATION_SAFETY';
ALTER TYPE "BackupTrigger" ADD VALUE 'MIGRATED';

-- AlterTable
ALTER TABLE "backup_records" ADD COLUMN     "sourceBackupId" TEXT;

-- CreateIndex
CREATE INDEX "backup_records_sourceBackupId_idx" ON "backup_records"("sourceBackupId");

-- AddForeignKey
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_sourceBackupId_fkey" FOREIGN KEY ("sourceBackupId") REFERENCES "backup_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
