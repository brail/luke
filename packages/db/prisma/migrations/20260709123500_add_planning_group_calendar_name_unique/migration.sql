/*
  Warnings:

  - A unique constraint covering the columns `[calendarId,name]` on the table `planning_groups` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "planning_groups_calendarId_name_key" ON "planning_groups"("calendarId", "name");
