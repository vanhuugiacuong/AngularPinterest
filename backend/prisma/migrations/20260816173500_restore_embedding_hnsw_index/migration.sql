-- Prisma's diff engine cannot see the HNSW index on the `embedding` column
-- (it's an Unsupported("vector(512)") field), so the previous migration's
-- auto-generated diff dropped it. Restore it here since it's load-bearing
-- for CLIP similarity search performance (pins.service getSimilarPins).
CREATE INDEX "Pin_embedding_hnsw_idx" ON "Pin" USING hnsw (embedding vector_cosine_ops);
