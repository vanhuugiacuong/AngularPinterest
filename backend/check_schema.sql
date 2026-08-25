-- Check if Pin table exists
SELECT EXISTS(
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'Pin'
) as pin_table_exists;

-- Check if embedding column exists
SELECT EXISTS(
  SELECT FROM information_schema.columns
  WHERE table_schema = 'public'
  AND table_name = 'Pin'
  AND column_name = 'embedding'
) as embedding_column_exists;

-- List all columns in Pin table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'Pin'
ORDER BY ordinal_position;
