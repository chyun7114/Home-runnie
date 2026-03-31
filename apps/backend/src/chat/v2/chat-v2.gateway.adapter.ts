import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
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
    private readonly configService: ConfigService,
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

    if (this.configService.get<string>('CHAT_USE_EXTERNAL_BROKERS', 'false') === 'true') {
      socket.emit('v2_ready', {
        message: 'v2 채팅 실험 경로가 활성화되었습니다.',
      });
      return;
    }

    socket.emit('v2_not_ready', {
      message: 'v2 채팅 스켈레톤 단계입니다.',
    });
    socket.disconnect();
    this.logger.log(`v2 skeleton socket disconnected: ${socket.id}`);
  }

  @SubscribeMessage('v2_message')
  async handleV2Message(
    @MessageBody() data: { roomId: string; message: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const payload = {
      roomId: data.roomId,
      message: data.message,
      socketId: socket.id,
      receivedAt: new Date().toISOString(),
    };

    await Promise.all([
      this.messageBusPort.publish(`chat.v2.room.${data.roomId}`, payload),
      this.eventPublisherPort.publish('chat.v2.message.received', payload),
    ]);

    socket.emit('v2_message_accepted', {
      roomId: data.roomId,
      accepted: true,
    });
  }
}
