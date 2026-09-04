-- CreateTable
CREATE TABLE "nav_sync_filters" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "navNos" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_sync_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nav_sync_filters_entity_key" ON "nav_sync_filters"("entity");
