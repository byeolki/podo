import { Module } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { StreamingController } from './streaming.controller';
import { TranscodeCacheService } from './transcode-cache.service';

@Module({
  providers: [StreamingService, TranscodeCacheService],
  controllers: [StreamingController],
  exports: [StreamingService, TranscodeCacheService],
})
export class StreamingModule {}
