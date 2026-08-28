import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const email = process.argv[2];
  if (!email) throw new Error('Usage: ts-node lookup_user.ts <email> [--promote]');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log('Not found.');
  } else if (process.argv[3] === '--promote') {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isAdmin: true },
    });
    console.log('Promoted to admin:', updated.id, updated.username, updated.email);
  } else {
    console.log(user);
  }
  await prisma.$disconnect();
  await pool.end();
}
run();
