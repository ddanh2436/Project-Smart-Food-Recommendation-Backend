import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiService } from './ai.service';

@Module({
  imports: [
    HttpModule.register({
      // Default ceiling; individual calls override it per endpoint.
      timeout: 30_000,
      maxRedirects: 3,
    }),
  ],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
