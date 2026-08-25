import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn('DATABASE_URL is not set in environment variables.');
    }
    // keepAlive + a longer idle timeout keep pooled connections warm so we
    // don't pay a fresh TLS handshake to the (cross-region) database on every
    // request after a short lull. max stays modest to respect Supabase's
    // session-pooler connection limit.
    const pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 10,
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
