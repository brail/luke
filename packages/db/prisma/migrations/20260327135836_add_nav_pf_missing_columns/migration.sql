-- AlterTable
ALTER TABLE "nav_pf_customer" ADD COLUMN     "customerPostingGroup" TEXT,
ADD COLUMN     "genBusPostingGroup" TEXT,
ADD COLUMN     "vatBusPostingGroup" TEXT;

-- AlterTable
ALTER TABLE "nav_pf_sales_header" ADD COLUMN     "customerPostingGroup" TEXT;
