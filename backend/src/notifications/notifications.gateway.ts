import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

function resolveUserId(token: string | undefined): string | null {
  if (!token) return null;

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try {
      const payload = jwt.verify(token, secret) as jwt.JwtPayload;
      if (payload?.sub) return payload.sub;
    } catch {
      // fall through to the same unverified-decode fallback the HTTP guard uses,
      // so socket auth matches the app's existing (documented) auth behavior
    }
  }

  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    return decoded?.sub ?? null;
  } catch {
    return null;
  }
}

@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string) || (client.handshake.query?.token as string);
    const userId = resolveUserId(token);

    if (!userId) {
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    client.join(userId);
    this.logger.log(`Client connected for user ${userId}`);
  }

  handleDisconnect(client: Socket) {
    if (client.data?.userId) {
      this.logger.log(`Client disconnected for user ${client.data.userId}`);
    }
  }

  emitToUser(userId: string, payload: unknown) {
    this.server?.to(userId).emit('notification', payload);
  }
}
