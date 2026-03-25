-- Add composite index on nav_sync_filters(entity, active) for filter lookup queries
CREATE INDEX IF NOT EXISTS "nav_sync_filters_entity_active_idx" ON "nav_sync_filters"("entity", "active");
