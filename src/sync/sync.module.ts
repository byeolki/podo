import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsGateway } from './events.gateway';
import { SyncController } from './sync.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [EventsService, EventsGateway],
  controllers: [SyncController],
  exports: [EventsService],
})
export class SyncModule {}
