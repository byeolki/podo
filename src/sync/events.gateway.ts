import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { EventsService } from './events.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/api/v1/events' })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
  ) {}

  afterInit() {
    this.events.on('*', (data) => {
      this.server.emit('event', data);
    });
  }

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined
      ?? (client.handshake.headers.authorization as string | undefined)?.replace('Bearer ', '');

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      this.jwt.verify(token);
      this.logger.debug(`Client connected: ${client.id}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }
}
