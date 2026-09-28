-- CreateEnum
CREATE TYPE "CalendarDigestDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'ABANDONED');

-- CreateTable
CREATE TABLE "calendar_digest_deliveries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "CalendarDigestDeliveryStatus" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "claimToken" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_digest_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_digest_deliveries_calendarId_idx" ON "calendar_digest_deliveries"("calendarId");

-- CreateIndex
CREATE INDEX "calendar_digest_deliveries_status_expiresAt_idx" ON "calendar_digest_deliveries"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "calendar_digest_deliveries_expiresAt_idx" ON "calendar_digest_deliveries"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_digest_deliveries_userId_localDate_calendarId_key" ON "calendar_digest_deliveries"("userId", "localDate", "calendarId");

-- AddForeignKey
ALTER TABLE "calendar_digest_deliveries" ADD CONSTRAINT "calendar_digest_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_digest_deliveries" ADD CONSTRAINT "calendar_digest_deliveries_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "season_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
