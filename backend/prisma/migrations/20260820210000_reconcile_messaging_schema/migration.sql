-- Reconcile the shared database's original messaging schema with the current
-- NestJS/Prisma domain model. Renames preserve all existing conversations.
ALTER TABLE "Conversation" RENAME COLUMN "userAId" TO "userOneId";
ALTER TABLE "Conversation" RENAME COLUMN "userBId" TO "userTwoId";
ALTER TABLE "Conversation" ADD COLUMN "participantKey" TEXT;
UPDATE "Conversation" SET "participantKey" = LEAST("userOneId", "userTwoId") || ':' || GREATEST("userOneId", "userTwoId");
ALTER TABLE "Conversation" ALTER COLUMN "participantKey" SET NOT NULL;
CREATE UNIQUE INDEX "Conversation_participantKey_key" ON "Conversation"("participantKey");

ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);
UPDATE "Message" SET "readAt" = "createdAt" WHERE "isRead" = true;
UPDATE "Message" SET "content" = '' WHERE "content" IS NULL;
ALTER TABLE "Message" ALTER COLUMN "content" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "content" TYPE VARCHAR(4000);

CREATE UNIQUE INDEX "MessageRequest_senderId_receiverId_key" ON "MessageRequest"("senderId", "receiverId");
CREATE INDEX "MessageRequest_receiverId_status_idx" ON "MessageRequest"("receiverId", "status");
CREATE INDEX "MessageRequest_senderId_status_idx" ON "MessageRequest"("senderId", "status");

ALTER TABLE "Notification" RENAME COLUMN "recipientId" TO "userId";
ALTER TABLE "Notification" RENAME COLUMN "actorId" TO "senderId";
ALTER TABLE "Notification" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "content" TEXT NOT NULL DEFAULT '';
UPDATE "Notification" SET "content" = COALESCE("commentSnippet", "type");
ALTER TABLE "Notification" ALTER COLUMN "content" DROP DEFAULT;

CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_SPEECH', 'IMPERSONATION', 'INAPPROPRIATE_CONTENT', 'OTHER');
CREATE TABLE "UserBlock" (
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId"),
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

CREATE TABLE "UserReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reportedId" TEXT NOT NULL,
  "reason" "ReportReason" NOT NULL,
  "details" TEXT,
  "messageRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserReport_messageRequestId_fkey" FOREIGN KEY ("messageRequestId") REFERENCES "MessageRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserReport_messageRequestId_key" ON "UserReport"("messageRequestId");
CREATE INDEX "UserReport_reportedId_idx" ON "UserReport"("reportedId");
CREATE INDEX "UserReport_reporterId_idx" ON "UserReport"("reporterId");
