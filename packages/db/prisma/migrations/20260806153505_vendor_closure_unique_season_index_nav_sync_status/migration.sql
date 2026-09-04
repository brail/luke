-- AlterTable
ALTER TABLE "nav_sync_filters" ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncStatus" TEXT;

-- CreateIndex
CREATE INDEX "seasons_isActive_name_idx" ON "seasons"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_closure_periods_vendorId_seasonId_sourceHolidayId_key" ON "vendor_closure_periods"("vendorId", "seasonId", "sourceHolidayId");

