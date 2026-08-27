-- AlterTable (add-only, safe against the shared DB)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showAllPins" BOOLEAN NOT NULL DEFAULT true;
