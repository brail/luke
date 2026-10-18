-- CreateTable
CREATE TABLE "notification_dedup_keys" (
    "key" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_dedup_keys_pkey" PRIMARY KEY ("key")
);

