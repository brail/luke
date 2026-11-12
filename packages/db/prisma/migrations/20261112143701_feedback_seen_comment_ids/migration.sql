-- AlterTable
ALTER TABLE "feedback_submissions" ADD COLUMN     "commentIdsTrackedAt" TIMESTAMP(3),
ADD COLUMN     "seenCommentIds" BIGINT[] DEFAULT ARRAY[]::BIGINT[];
