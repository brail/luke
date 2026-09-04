-- CreateEnum
CREATE TYPE "MerchandisingPlanStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "MerchandisingGender" AS ENUM ('MAN', 'WOMAN', 'UNISEX', 'KID');

-- CreateEnum
CREATE TYPE "MerchandisingLifeType" AS ENUM ('NEW_LINE', 'NEW_STYLE', 'NEW_COLOR', 'CARRY_OVER');

-- CreateEnum
CREATE TYPE "MerchandisingLaunchType" AS ENUM ('SAMPLED', 'OPEN_TO_BUY');

-- CreateEnum
CREATE TYPE "SpecsheetComponentSection" AS ENUM ('UPPER', 'LINING', 'ACCESSORIES', 'SOLE', 'OTHER');

-- CreateTable
CREATE TABLE "merchandising_plans" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "MerchandisingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchandising_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandising_plan_rows" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "articleCode" TEXT NOT NULL,
    "styleDescription" TEXT NOT NULL,
    "styleCode" TEXT,
    "colorCode" TEXT NOT NULL,
    "colorDescription" TEXT NOT NULL,
    "gender" "MerchandisingGender" NOT NULL,
    "productCategory" TEXT NOT NULL,
    "lineCode" TEXT,
    "lifeType" "MerchandisingLifeType",
    "carryoverFromSeason" TEXT,
    "launchType" "MerchandisingLaunchType",
    "smsPairsOrder" INTEGER,
    "targetPairs" INTEGER,
    "cancellationStatus" TEXT,
    "designer" TEXT,
    "pricingParameterSetId" TEXT,
    "targetFobPrice" DECIMAL(10,4),
    "firstOfferPrice" DECIMAL(10,4),
    "finalOfferPrice" DECIMAL(10,4),
    "retailTargetIt" DECIMAL(10,4),
    "wholesaleIt" DECIMAL(10,4),
    "retailTargetEu" DECIMAL(10,4),
    "wholesaleEu" DECIMAL(10,4),
    "pricingNotes" TEXT,
    "generalNotes" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchandising_plan_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandising_specsheets" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "madeIn" TEXT,
    "supplierName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchandising_specsheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandising_components" (
    "id" TEXT NOT NULL,
    "specsheetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "section" "SpecsheetComponentSection" NOT NULL,
    "partNumber" TEXT,
    "component" TEXT NOT NULL,
    "material" TEXT,
    "color" TEXT,
    "pantoneNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchandising_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandising_images" (
    "id" TEXT NOT NULL,
    "specsheetId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchandising_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchandising_plans_brandId_seasonId_idx" ON "merchandising_plans"("brandId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "merchandising_plans_brandId_seasonId_key" ON "merchandising_plans"("brandId", "seasonId");

-- CreateIndex
CREATE INDEX "merchandising_plan_rows_planId_idx" ON "merchandising_plan_rows"("planId");

-- CreateIndex
CREATE INDEX "merchandising_plan_rows_assignedUserId_idx" ON "merchandising_plan_rows"("assignedUserId");

-- CreateIndex
CREATE INDEX "merchandising_plan_rows_pricingParameterSetId_idx" ON "merchandising_plan_rows"("pricingParameterSetId");

-- CreateIndex
CREATE UNIQUE INDEX "merchandising_specsheets_rowId_key" ON "merchandising_specsheets"("rowId");

-- CreateIndex
CREATE INDEX "merchandising_components_specsheetId_section_order_idx" ON "merchandising_components"("specsheetId", "section", "order");

-- CreateIndex
CREATE INDEX "merchandising_images_specsheetId_order_idx" ON "merchandising_images"("specsheetId", "order");

-- AddForeignKey
ALTER TABLE "merchandising_plans" ADD CONSTRAINT "merchandising_plans_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_plans" ADD CONSTRAINT "merchandising_plans_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_plan_rows" ADD CONSTRAINT "merchandising_plan_rows_planId_fkey" FOREIGN KEY ("planId") REFERENCES "merchandising_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_plan_rows" ADD CONSTRAINT "merchandising_plan_rows_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_plan_rows" ADD CONSTRAINT "merchandising_plan_rows_pricingParameterSetId_fkey" FOREIGN KEY ("pricingParameterSetId") REFERENCES "pricing_parameter_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_specsheets" ADD CONSTRAINT "merchandising_specsheets_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "merchandising_plan_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_components" ADD CONSTRAINT "merchandising_components_specsheetId_fkey" FOREIGN KEY ("specsheetId") REFERENCES "merchandising_specsheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_images" ADD CONSTRAINT "merchandising_images_specsheetId_fkey" FOREIGN KEY ("specsheetId") REFERENCES "merchandising_specsheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
