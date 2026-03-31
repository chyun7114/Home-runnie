import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';
import {
  EVENT_PUBLISHER_PORT,
  EventPublisherPort,
  MESSAGE_BUS_PORT,
  MessageBusPort,
} from '@/chat/application/port';

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

  constructor(
    @Inject(MESSAGE_BUS_PORT) private readonly messageBusPort: MessageBusPort,
    @Inject(EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: EventPublisherPort,
  ) {}

  async handleConnection(socket: Socket) {
    const payload = {
      socketId: socket.id,
      receivedAt: new Date().toISOString(),
    };

    try {
      await Promise.all([
        this.messageBusPort.publish('chat.v2.connection', payload),
        this.eventPublisherPort.publish('chat.v2.connection.received', payload),
      ]);
    } catch (error) {
      this.logger.warn(
        `v2 브로커 기록 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    socket.emit('v2_not_ready', {
      message: 'v2 채팅 스켈레톤 단계입니다.',
    });
    socket.disconnect();
    this.logger.log(`v2 skeleton socket disconnected: ${socket.id}`);
  }
}
