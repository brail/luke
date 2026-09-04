-- CreateTable
CREATE TABLE "collection_row_phase_history" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_row_phase_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_row_phase_history_rowId_reachedAt_idx" ON "collection_row_phase_history"("rowId", "reachedAt");

-- CreateIndex
CREATE INDEX "collection_row_phase_history_phaseId_reachedAt_idx" ON "collection_row_phase_history"("phaseId", "reachedAt");

-- AddForeignKey
ALTER TABLE "collection_row_phase_history" ADD CONSTRAINT "collection_row_phase_history_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "collection_layout_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_row_phase_history" ADD CONSTRAINT "collection_row_phase_history_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_row_phase_history" ADD CONSTRAINT "collection_row_phase_history_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
