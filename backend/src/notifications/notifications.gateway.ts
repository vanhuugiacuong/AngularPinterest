import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { verifySupabaseToken } from '../supabase/supabase-jwt';

/**
 * Chỉ nhận token đúng chữ ký, và dùng chung cách kiểm với HTTP (supabase-jwt.ts)
 * để socket không tụt lại phía sau khi Supabase đổi kiểu khoá.
 *
 * Trước đây chỗ này kiểm HS256 rồi hỏng thì rơi xuống giải mã base64 tin luôn —
 * mà token thật lại ký ES256 nên nhánh hỏng LUÔN được dùng: ai bịa `sub` cũng
 * vào được phòng thông báo của người khác và đọc thông báo riêng của họ.
 */
async function resolveUserId(token: string | undefined): Promise<string | null> {
  const payload = await verifySupabaseToken(token);
  return typeof payload?.sub === 'string' ? payload.sub : null;
}

@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string) || (client.handshake.query?.token as string);
    const userId = await resolveUserId(token);

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
