-- CreateTable
CREATE TABLE "_VendorEnabledParameterSets" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VendorEnabledParameterSets_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_VendorEnabledParameterSets_B_index" ON "_VendorEnabledParameterSets"("B");

-- AddForeignKey
ALTER TABLE "_VendorEnabledParameterSets" ADD CONSTRAINT "_VendorEnabledParameterSets_A_fkey" FOREIGN KEY ("A") REFERENCES "pricing_parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VendorEnabledParameterSets" ADD CONSTRAINT "_VendorEnabledParameterSets_B_fkey" FOREIGN KEY ("B") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
