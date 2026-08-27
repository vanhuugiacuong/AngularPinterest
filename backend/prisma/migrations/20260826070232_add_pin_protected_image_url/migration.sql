-- Additive, nullable column — no data migration, no impact on existing rows/queries.
ALTER TABLE "Pin" ADD COLUMN "protectedImageUrl" TEXT;
