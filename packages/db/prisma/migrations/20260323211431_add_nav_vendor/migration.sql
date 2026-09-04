-- CreateTable
CREATE TABLE "nav_vendors" (
    "navNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name2" TEXT,
    "searchName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "address" TEXT,
    "address2" TEXT,
    "postCode" TEXT,
    "city" TEXT,
    "county" TEXT,
    "countryCode" TEXT,
    "phoneNo" TEXT,
    "faxNo" TEXT,
    "email" TEXT,
    "homePage" TEXT,
    "contact" TEXT,
    "vendorType" TEXT,
    "navLastModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_vendors_pkey" PRIMARY KEY ("navNo")
);

-- CreateIndex
CREATE INDEX "nav_vendors_name_idx" ON "nav_vendors"("name");

-- CreateIndex
CREATE INDEX "nav_vendors_syncedAt_idx" ON "nav_vendors"("syncedAt");
