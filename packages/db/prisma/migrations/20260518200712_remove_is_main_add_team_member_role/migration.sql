/*
  Warnings:

  - You are about to drop the column `isMain` on the `company_teams` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CompanyTeamMemberRole" AS ENUM ('LEADER', 'MEMBER');

-- AlterTable
ALTER TABLE "company_team_memberships" ADD COLUMN     "role" "CompanyTeamMemberRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "company_teams" DROP COLUMN "isMain";
