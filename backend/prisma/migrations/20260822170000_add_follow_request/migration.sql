-- CreateEnum
CREATE TYPE "FollowRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "FollowRequest" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "status" "FollowRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "FollowRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowRequest_receiverId_status_idx" ON "FollowRequest"("receiverId", "status");

-- CreateIndex
CREATE INDEX "FollowRequest_senderId_status_idx" ON "FollowRequest"("senderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FollowRequest_senderId_receiverId_key" ON "FollowRequest"("senderId", "receiverId");

-- AddForeignKey
ALTER TABLE "FollowRequest" ADD CONSTRAINT "FollowRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowRequest" ADD CONSTRAINT "FollowRequest_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
