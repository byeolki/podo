import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type EventName =
  | 'track.upserted'
  | 'track.removed'
  | 'source.removed'
  | 'scan.started'
  | 'scan.progress'
  | 'scan.completed'
  | 'scan.failed'
  | 'library.changed';

@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();

  emit(event: EventName, payload: Record<string, unknown>): void {
    this.emitter.emit(event, payload);
    this.emitter.emit('*', { event, payload });
  }

  on(event: EventName | '*', handler: (payload: Record<string, unknown>) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: EventName | '*', handler: (payload: Record<string, unknown>) => void): void {
    this.emitter.off(event, handler);
  }
}
