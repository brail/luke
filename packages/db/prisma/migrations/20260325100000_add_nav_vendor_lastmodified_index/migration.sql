-- Add index on nav_vendors.navLastModified for differential sync watermark queries
-- (WHERE "navLastModified" > @watermark OR "navLastModified" IS NULL)
CREATE INDEX IF NOT EXISTS "nav_vendors_navLastModified_idx" ON "nav_vendors"("navLastModified");
