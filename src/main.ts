import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  console.log("========================================");
  console.log("🔍 DEBUG ENV VARIABLES (RENDER):");
  console.log("👉 PORT:", process.env.PORT);
  console.log("👉 AI_SERVICE_URL:", process.env.AI_SERVICE_URL); // Quan trọng nhất
  console.log("👉 FRONTEND_URL:", process.env.FRONTEND_URL);
  console.log("========================================");
  app.useGlobalPipes(new ValidationPipe()); // Sử dụng ValidationPipe toàn cục

  app.enableCors({
    origin: "*", 
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
