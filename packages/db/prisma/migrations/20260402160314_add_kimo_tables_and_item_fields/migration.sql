-- DropIndex
DROP INDEX "public"."nav_pf_budget_header_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_customer_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_geo_zone_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_item_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_sales_header_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_sales_header_ext_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_sales_line_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_salesperson_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_ship_to_address_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_shipment_method_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_transport_reason_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_variable_code_navRowversion_idx";

-- DropIndex
DROP INDEX "public"."nav_pf_vendor_navRowversion_idx";

-- AlterTable
ALTER TABLE "nav_pf_item" ADD COLUMN     "seasonCode" TEXT,
ADD COLUMN     "trademarkCode" TEXT;

-- CreateTable
CREATE TABLE "nav_kimo_sales_header" (
    "entryNo" BIGINT NOT NULL,
    "trademarkCode" TEXT,
    "salespersonCodeNav" TEXT,
    "assignedSalesDocumentNo" TEXT,
    "sellToCustomerNo" TEXT,
    "createSoDateTime" TIMESTAMP(3),
    "releaseSoDateTime" TIMESTAMP(3),
    "kimoDocumentType" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_kimo_sales_header_pkey" PRIMARY KEY ("entryNo")
);

-- CreateTable
CREATE TABLE "nav_kimo_sales_line" (
    "headerEntryNo" BIGINT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "no_" TEXT,
    "modelItemNo" TEXT,
    "colorCode" TEXT,
    "sizeCode" TEXT,
    "quantity" DOUBLE PRECISION,
    "lineAmount" DOUBLE PRECISION,
    "kimoFashionSoReference" TEXT,
    "type" INTEGER,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_kimo_sales_line_pkey" PRIMARY KEY ("headerEntryNo","lineNo")
);

-- CreateTable
CREATE TABLE "nav_kimo_assortimenti" (
    "assortmentCode" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "nav_kimo_assortimenti_pkey" PRIMARY KEY ("assortmentCode")
);

-- CreateIndex
CREATE INDEX "nav_kimo_sales_header_trademarkCode_idx" ON "nav_kimo_sales_header"("trademarkCode");

-- CreateIndex
CREATE INDEX "nav_kimo_sales_header_salespersonCodeNav_idx" ON "nav_kimo_sales_header"("salespersonCodeNav");

-- CreateIndex
CREATE INDEX "nav_kimo_sales_header_assignedSalesDocumentNo_idx" ON "nav_kimo_sales_header"("assignedSalesDocumentNo");

-- CreateIndex
CREATE INDEX "nav_kimo_sales_header_sellToCustomerNo_idx" ON "nav_kimo_sales_header"("sellToCustomerNo");

-- CreateIndex
CREATE INDEX "nav_kimo_sales_line_headerEntryNo_idx" ON "nav_kimo_sales_line"("headerEntryNo");

-- CreateIndex
CREATE INDEX "nav_kimo_sales_line_modelItemNo_idx" ON "nav_kimo_sales_line"("modelItemNo");

-- CreateIndex
CREATE INDEX "nav_pf_item_seasonCode_idx" ON "nav_pf_item"("seasonCode");

-- CreateIndex
CREATE INDEX "nav_pf_item_trademarkCode_idx" ON "nav_pf_item"("trademarkCode");
