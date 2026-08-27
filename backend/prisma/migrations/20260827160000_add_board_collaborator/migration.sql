CREATE TABLE IF NOT EXISTS "BoardCollaborator" (
  "boardId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoardCollaborator_pkey" PRIMARY KEY ("boardId", "userId")
);

DO $$ BEGIN
  ALTER TABLE "BoardCollaborator"
  ADD CONSTRAINT "BoardCollaborator_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BoardCollaborator"
  ADD CONSTRAINT "BoardCollaborator_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
