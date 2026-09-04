-- Create new 'data' column with consolidated preferences
ALTER TABLE "user_preferences" ADD COLUMN "data" JSONB DEFAULT '{}';

-- Migrate existing data into 'data' column
-- Consolidates: lastBrandId, lastSeasonId, menuCollapsibleStates into structured JSON
UPDATE "user_preferences"
SET "data" = jsonb_build_object(
  'lastBrandId', "lastBrandId",
  'lastSeasonId', "lastSeasonId",
  'menuStates', COALESCE("menuCollapsibleStates", '{}'::jsonb)
)
WHERE "lastBrandId" IS NOT NULL
   OR "lastSeasonId" IS NOT NULL
   OR "menuCollapsibleStates" IS NOT NULL;

-- Drop old columns
ALTER TABLE "user_preferences"
  DROP COLUMN IF EXISTS "lastBrandId",
  DROP COLUMN IF EXISTS "lastSeasonId",
  DROP COLUMN IF EXISTS "menuCollapsibleStates",
  DROP COLUMN IF EXISTS "pinnedContexts";

-- Drop index on old column
DROP INDEX IF EXISTS "public"."user_preferences_lastBrandId_idx";
