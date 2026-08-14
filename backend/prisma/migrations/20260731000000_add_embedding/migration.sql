-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "Pin" ADD COLUMN "embedding" vector(512);

-- CreateIndex (HNSW index for cosine similarity search)
CREATE INDEX ON "Pin" USING hnsw (embedding vector_cosine_ops);
