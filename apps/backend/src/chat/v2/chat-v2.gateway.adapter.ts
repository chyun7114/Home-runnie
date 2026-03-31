import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';

@WebSocketGateway({
  namespace: CHAT_WS_NAMESPACES.V2,
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,https://www.homerunnie.app').split(
      ',',
    ),
    credentials: true,
  },
})
export class ChatV2GatewayAdapter implements OnGatewayConnection {
  private readonly logger = new Logger(ChatV2GatewayAdapter.name);

  handleConnection(socket: Socket) {
    socket.emit('v2_not_ready', {
      message: 'v2 채팅 스켈레톤 단계입니다.',
    });
    socket.disconnect();
    this.logger.log(`v2 skeleton socket disconnected: ${socket.id}`);
  }
}
