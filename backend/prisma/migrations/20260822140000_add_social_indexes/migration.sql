CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");
CREATE INDEX "Board_userId_isSecret_createdAt_idx" ON "Board"("userId", "isSecret", "createdAt");
CREATE INDEX "Like_userId_createdAt_idx" ON "Like"("userId", "createdAt");
