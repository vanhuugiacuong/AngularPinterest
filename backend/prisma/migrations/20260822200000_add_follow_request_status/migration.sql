CREATE TYPE "FollowStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- Existing rows were created under the old instant-follow model — default
-- them to ACCEPTED so nobody's current followers disappear, then flip the
-- column default to PENDING for all new follow requests going forward.
ALTER TABLE "Follow" ADD COLUMN "status" "FollowStatus" NOT NULL DEFAULT 'ACCEPTED';
ALTER TABLE "Follow" ADD COLUMN "respondedAt" TIMESTAMP(3);
UPDATE "Follow" SET "respondedAt" = "createdAt" WHERE "status" = 'ACCEPTED';
ALTER TABLE "Follow" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE INDEX "Follow_followingId_status_idx" ON "Follow"("followingId", "status");
