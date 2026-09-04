/*
  Warnings:

  - You are about to drop the column `progressWarningDays` on the `calendar_events` table. All the data in the column will be lost.
  - You are about to drop the column `relevantCountries` on the `calendar_events` table. All the data in the column will be lost.
  - You are about to drop the column `requiredCollectionProgress` on the `calendar_events` table. All the data in the column will be lost.
  - You are about to drop the column `severity` on the `calendar_events` table. All the data in the column will be lost.
  - You are about to drop the column `relevantCountries` on the `milestone_template_items` table. All the data in the column will be lost.
  - You are about to drop the column `severity` on the `milestone_template_items` table. All the data in the column will be lost.
  - You are about to drop the `calendar_event_dependencies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestone_template_dependencies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "calendar_event_dependencies" DROP CONSTRAINT "calendar_event_dependencies_predecessorId_fkey";

-- DropForeignKey
ALTER TABLE "calendar_event_dependencies" DROP CONSTRAINT "calendar_event_dependencies_successorId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_template_dependencies" DROP CONSTRAINT "milestone_template_dependencies_predecessorId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_template_dependencies" DROP CONSTRAINT "milestone_template_dependencies_successorId_fkey";

-- AlterTable
ALTER TABLE "calendar_events" DROP COLUMN "progressWarningDays",
DROP COLUMN "relevantCountries",
DROP COLUMN "requiredCollectionProgress",
DROP COLUMN "severity";

-- AlterTable
ALTER TABLE "milestone_template_items" DROP COLUMN "relevantCountries",
DROP COLUMN "severity";

-- DropTable
DROP TABLE "calendar_event_dependencies";

-- DropTable
DROP TABLE "milestone_template_dependencies";

-- DropEnum
DROP TYPE "DependencySeverity";

-- DropEnum
DROP TYPE "EventSeverity";
