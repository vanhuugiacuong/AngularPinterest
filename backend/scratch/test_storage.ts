import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  
  if (!url || !key) {
    console.error('Missing env configuration!', { url, key });
    return;
  }

  console.log('Using URL:', url);
  console.log('Using Key starting with:', key.substring(0, 15));

  const supabase = createClient(url, key);
  
  // 1. List buckets
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('Error listing buckets:', error);
    return;
  }
  console.log('Buckets list:', buckets.map(b => b.name));

  // 2. Check if 'pins' bucket exists, if not, create it
  const hasPins = buckets.some(b => b.name === 'pins');
  if (!hasPins) {
    console.log("Bucket 'pins' does not exist. Attempting to create it...");
    const { data: newBucket, error: createError } = await supabase.storage.createBucket('pins', {
      public: true,
      allowedMimeTypes: ['image/*'],
      fileSizeLimit: 10485760 // 10MB
    });
    if (createError) {
      console.error('Error creating bucket:', createError);
    } else {
      console.log('Successfully created pins bucket!', newBucket);
    }
  } else {
    console.log("Bucket 'pins' already exists.");
  }
}

run();
