import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import fs from 'fs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL is not set!');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setupNotifications() {
  try {
    console.log('🚀 Starting database setup...');

    // Read SQL file
    const sql = fs.readFileSync('./setup_notifications.sql', 'utf-8');

    // Execute SQL
    console.log('📝 Creating Notification table and indexes...');
    await prisma.$executeRawUnsafe(sql);

    console.log('✅ Database setup completed successfully!');
    console.log('📊 The Notification table is now ready to use.');

  } catch (error) {
    console.error('❌ Error during setup:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

setupNotifications();
