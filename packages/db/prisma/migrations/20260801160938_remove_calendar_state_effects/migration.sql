/*
  Warnings:

  - You are about to drop the column `lockedAt` on the `collection_layouts` table. All the data in the column will be lost.
  - You are about to drop the column `lockedByEventId` on the `collection_layouts` table. All the data in the column will be lost.
  - You are about to drop the `calendar_event_effect_executions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `calendar_event_state_effects` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestone_template_state_effects` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "calendar_event_effect_executions" DROP CONSTRAINT "calendar_event_effect_executions_appliedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "calendar_event_effect_executions" DROP CONSTRAINT "calendar_event_effect_executions_effectId_fkey";

-- DropForeignKey
ALTER TABLE "calendar_event_effect_executions" DROP CONSTRAINT "calendar_event_effect_executions_eventId_fkey";

-- DropForeignKey
ALTER TABLE "calendar_event_effect_executions" DROP CONSTRAINT "calendar_event_effect_executions_rolledBackByUserId_fkey";

-- DropForeignKey
ALTER TABLE "calendar_event_state_effects" DROP CONSTRAINT "calendar_event_state_effects_eventId_fkey";

-- DropForeignKey
ALTER TABLE "collection_layouts" DROP CONSTRAINT "collection_layouts_lockedByEventId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_template_state_effects" DROP CONSTRAINT "milestone_template_state_effects_templateItemId_fkey";

-- DropIndex
DROP INDEX "collection_layouts_lockedByEventId_idx";

-- AlterTable
ALTER TABLE "collection_layouts" DROP COLUMN "lockedAt",
DROP COLUMN "lockedByEventId";

-- DropTable
DROP TABLE "calendar_event_effect_executions";

-- DropTable
DROP TABLE "calendar_event_state_effects";

-- DropTable
DROP TABLE "milestone_template_state_effects";

-- DropEnum
DROP TYPE "StateEffectType";
