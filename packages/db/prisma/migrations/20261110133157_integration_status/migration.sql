-- CreateTable
CREATE TABLE "integration_statuses" (
    "integration" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "integration_statuses_pkey" PRIMARY KEY ("integration")
);
