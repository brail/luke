-- AlterTable
ALTER TABLE "file_objects" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "file_objects_confirmedAt_idx" ON "file_objects"("confirmedAt");
