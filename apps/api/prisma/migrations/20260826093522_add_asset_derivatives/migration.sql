-- AlterTable
ALTER TABLE "file_objects" ADD COLUMN     "derivativeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "derivativesStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "pipelineVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variant" TEXT,
ADD COLUMN     "width" INTEGER;

-- CreateIndex
CREATE INDEX "file_objects_parentId_idx" ON "file_objects"("parentId");

-- CreateIndex
CREATE INDEX "file_objects_derivativesStatus_idx" ON "file_objects"("derivativesStatus");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_parentId_variant_pipelineVersion_key" ON "file_objects"("parentId", "variant", "pipelineVersion");

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "file_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

