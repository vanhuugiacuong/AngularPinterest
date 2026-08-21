-- Align migration-tracked index name with the name already present in the
-- database (created manually via scratch/setup_pgvector.ts before this
-- migration history existed).
ALTER INDEX "Pin_embedding_idx" RENAME TO "Pin_embedding_hnsw_idx";
