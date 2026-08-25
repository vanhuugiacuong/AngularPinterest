import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

// Kept under /api so the root path "/" is free for the served Angular SPA
// (ServeStaticModule serves index.html there). Doubles as Railway's healthcheck.
@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth(): { status: string } {
    return { status: this.appService.getHello() };
  }
}
