-- DropIndex
DROP INDEX "notification_preferences_userId_category_key";

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "eventKey" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_eventKey_key" ON "notification_preferences"("userId", "category", "eventKey");

-- CreateIndex
CREATE INDEX "notifications_userId_isArchived_idx" ON "notifications"("userId", "isArchived");

