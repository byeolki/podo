import { Module } from '@nestjs/common';
import { RadioService } from './radio.service';
import { RadioController } from './radio.controller';

@Module({
  providers: [RadioService],
  controllers: [RadioController],
})
export class RadioModule {}
