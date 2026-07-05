import { Module } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { BroadcastController } from './broadcast.controller';

@Module({
  providers: [BroadcastService],
  controllers: [BroadcastController],
})
export class BroadcastModule {}
