-- AlterTable
ALTER TABLE "collection_catalog_items" ADD COLUMN     "expectedMinProgress" TEXT,
ADD COLUMN     "iso9001Categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "collection_layout_rows" ADD COLUMN     "lastRevisedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "collection_layout_revisions" (
    "id" TEXT NOT NULL,
    "collectionLayoutId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "revisionTypeValue" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "milestoneId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_layout_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_group_revisions" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "skuBudget" INTEGER,

    CONSTRAINT "collection_group_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_layout_row_revisions" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceGroupRevisionId" TEXT NOT NULL,
    "sourceRowId" TEXT NOT NULL,
    "wasDeleted" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "line" TEXT NOT NULL,
    "article" TEXT,
    "status" TEXT NOT NULL,
    "skuForecast" INTEGER NOT NULL,
    "qtyForecast" INTEGER NOT NULL,
    "productCategory" TEXT NOT NULL,
    "strategy" TEXT,
    "styleStatus" TEXT,
    "progress" TEXT,
    "designer" TEXT,
    "pictureKey" TEXT,
    "styleNotes" TEXT,
    "materialNotes" TEXT,
    "colorNotes" TEXT,
    "toolingNotes" TEXT,
    "toolingQuotation" DOUBLE PRECISION,
    "order" INTEGER NOT NULL,

    CONSTRAINT "collection_layout_row_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_row_quotation_revisions" (
    "id" TEXT NOT NULL,
    "rowRevisionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "pricingParameterSetId" TEXT,
    "pricingParameterSetName" TEXT,
    "retailPrice" DOUBLE PRECISION,
    "supplierQuotation" DOUBLE PRECISION,
    "notes" TEXT,
    "sku" INTEGER,

    CONSTRAINT "collection_row_quotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_layout_revisions_collectionLayoutId_createdAt_idx" ON "collection_layout_revisions"("collectionLayoutId", "createdAt");

-- CreateIndex
CREATE INDEX "collection_layout_revisions_milestoneId_idx" ON "collection_layout_revisions"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_layout_revisions_collectionLayoutId_revisionNumb_key" ON "collection_layout_revisions"("collectionLayoutId", "revisionNumber");

-- CreateIndex
CREATE INDEX "collection_group_revisions_revisionId_idx" ON "collection_group_revisions"("revisionId");

-- CreateIndex
CREATE INDEX "collection_group_revisions_sourceGroupId_idx" ON "collection_group_revisions"("sourceGroupId");

-- CreateIndex
CREATE INDEX "collection_layout_row_revisions_sourceRowId_revisionId_idx" ON "collection_layout_row_revisions"("sourceRowId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_layout_row_revisions_revisionId_sourceRowId_key" ON "collection_layout_row_revisions"("revisionId", "sourceRowId");

-- CreateIndex
CREATE INDEX "collection_row_quotation_revisions_rowRevisionId_idx" ON "collection_row_quotation_revisions"("rowRevisionId");

-- AddForeignKey
ALTER TABLE "collection_layout_revisions" ADD CONSTRAINT "collection_layout_revisions_collectionLayoutId_fkey" FOREIGN KEY ("collectionLayoutId") REFERENCES "collection_layouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layout_revisions" ADD CONSTRAINT "collection_layout_revisions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_group_revisions" ADD CONSTRAINT "collection_group_revisions_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "collection_layout_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layout_row_revisions" ADD CONSTRAINT "collection_layout_row_revisions_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "collection_layout_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layout_row_revisions" ADD CONSTRAINT "collection_layout_row_revisions_sourceGroupRevisionId_fkey" FOREIGN KEY ("sourceGroupRevisionId") REFERENCES "collection_group_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_row_quotation_revisions" ADD CONSTRAINT "collection_row_quotation_revisions_rowRevisionId_fkey" FOREIGN KEY ("rowRevisionId") REFERENCES "collection_layout_row_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
