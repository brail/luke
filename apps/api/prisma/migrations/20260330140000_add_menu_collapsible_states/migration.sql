-- Add menuCollapsibleStates column to user_preferences table
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "menuCollapsibleStates" JSONB DEFAULT '{}';
