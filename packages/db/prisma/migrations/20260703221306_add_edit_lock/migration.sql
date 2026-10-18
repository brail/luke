-- CreateEnum
CREATE TYPE "LockEntityType" AS ENUM ('SEASON_CALENDAR', 'COLLECTION_LAYOUT');

-- CreateTable
CREATE TABLE "edit_locks" (
    "id" TEXT NOT NULL,
    "entityType" "LockEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "lockedByUserId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edit_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edit_locks_entityType_entityId_key" ON "edit_locks"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "edit_locks" ADD CONSTRAINT "edit_locks_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
