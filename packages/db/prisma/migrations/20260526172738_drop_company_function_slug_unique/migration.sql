-- DropIndex
DROP INDEX IF EXISTS "public"."company_functions_slug_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "company_functions_slug_idx" ON "company_functions"("slug");

-- Partial unique index: slug unique only among active functions
CREATE UNIQUE INDEX IF NOT EXISTS "company_functions_slug_active_key" ON "company_functions"("slug") WHERE "isActive" = true;
