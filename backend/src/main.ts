import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/multer-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalFilters(new MulterExceptionFilter());
  const port = process.env.PORT ?? 3000;
  // Bind 0.0.0.0 so the container is reachable on Railway's assigned interface.
  await app.listen(port, '0.0.0.0');
  console.log(`[NestJS] Backend running on port ${port}`);
}
void bootstrap();
