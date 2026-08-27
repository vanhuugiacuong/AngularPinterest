import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Connection budget, because this is what EMAXCONNSESSION was about.
 *
 * Supavisor (the Supabase pooler) caps the whole project at 15 client
 * connections. That 15 is shared by every consumer at once:
 *
 *   this backend            PG_POOL_MAX (below)
 *   the other app's backend its own pool, same database
 *   each teammate running   another pool again
 *   each scratch/*.cjs run  1 while it runs
 *   Prisma Studio           1 while open
 *
 * Nothing here can see the others, so the only workable rule is that each
 * process keeps its own pool SMALL. Before this, node-postgres' default of
 * max: 10 applied — two backends alone asked for 20 of the 15, which is why the
 * pooler started refusing connections rather than queueing.
 *
 * 3 is not a throughput problem on the transaction-mode port (6543): a
 * connection is borrowed for the duration of one statement and handed straight
 * back, so three of them serve a great many sequential requests. Raise it on a
 * single production instance where nothing else shares the budget — via the env
 * var, not by editing this default, or the next person to run two apps hits the
 * same wall.
 *
 * Note also: DATABASE_URL must use port 6543 (transaction mode), not 5432
 * (session mode). In session mode each client holds a backend for its whole
 * lifetime, so a pool of N permanently occupies N of the 15 — the error text
 * "max clients reached in session mode" is that happening.
 *
 * `pgbouncer=true` in the URL is NOT needed here and does nothing: that flag
 * configures Prisma's own engine pooling, and this client uses the pg driver
 * adapter, so pg owns the pool. pg uses unnamed prepared statements, which
 * transaction mode supports.
 */
const DEFAULT_POOL_MAX = 3;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn('DATABASE_URL is not set in environment variables.');
    }

    const max = Number(process.env.PG_POOL_MAX) || DEFAULT_POOL_MAX;
    const pool = new Pool({
      connectionString,
      max,
      // Hand idle connections back to the pooler quickly. They are a shared,
      // scarce resource here, so holding one open for half a minute on the
      // chance it gets reused costs more than reconnecting.
      idleTimeoutMillis: 10_000,
      // Fail with a clear timeout instead of hanging when the budget really is
      // exhausted by someone else.
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    });

    // Without this an idle-client error is an unhandled 'error' event on the
    // pool, which takes the whole process down.
    pool.on('error', (error) => {
      console.error('Unexpected error on idle PostgreSQL client:', error);
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    // Printed on purpose: when connections run out, the first question is how
    // many this process asked for, and the answer should not require reading
    // the source.
    console.log(`[Prisma] pg pool max = ${this.pool.options.max} (PG_POOL_MAX)`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
    // $disconnect alone leaves the pg pool holding its sockets, so a restart
    // under `--watch` used to stack another pool on top of one the pooler still
    // counted. Requires enableShutdownHooks() in main.ts to actually run.
    await this.pool.end();
  }
}
