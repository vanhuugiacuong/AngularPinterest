import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn('DATABASE_URL is not set in environment variables.');
    }
    // keepAlive + idleTimeout keep pooled connections warm without exceeding
    // Supabase's session-pooler limit. max is capped at 5 to leave room for
    // hot-reloads and concurrent requests.
    const pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 5,
      keepAlive: true,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
