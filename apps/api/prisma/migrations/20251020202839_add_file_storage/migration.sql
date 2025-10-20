-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "file_objects_bucket_key_idx" ON "file_objects"("bucket", "key");

-- CreateIndex
CREATE INDEX "file_objects_createdAt_idx" ON "file_objects"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_bucket_key_key" ON "file_objects"("bucket", "key");
