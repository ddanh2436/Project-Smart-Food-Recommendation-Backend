import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe()); // Sử dụng ValidationPipe toàn cục
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
