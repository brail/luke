-- AlterTable: aggiunge pianificazione sync per-entità a nav_sync_filters
ALTER TABLE "nav_sync_filters" ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "nav_sync_filters" ADD COLUMN "intervalMinutes" INTEGER NOT NULL DEFAULT 30;
