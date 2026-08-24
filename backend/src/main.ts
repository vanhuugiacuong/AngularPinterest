import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/multer-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalFilters(new MulterExceptionFilter());
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`[NestJS] Backend running on: http://localhost:${port}`);
}
void bootstrap();
