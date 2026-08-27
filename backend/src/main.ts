import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Without this, onModuleDestroy never runs on SIGINT or on a `--watch`
  // restart, so PrismaService.onModuleDestroy could not close its pg pool: the
  // pooler kept counting the old process's connections against the project's
  // 15 while the new one opened its own. See the budget note in
  // database/prisma.service.ts.
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`[NestJS] Backend running on: http://localhost:${port}`);
}
bootstrap();
