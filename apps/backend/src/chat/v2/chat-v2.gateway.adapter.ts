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
import { randomUUID } from 'node:crypto';
import { CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';
import {
  EVENT_PUBLISHER_PORT,
  EventPublisherPort,
  MESSAGE_BUS_PORT,
  MessageBusPort,
} from '@/chat/application/port';
import { MetricsService } from '@/metrics/metrics.service';

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
    private readonly metricsService: MetricsService,
  ) {}

  async handleConnection(socket: Socket) {
    const payload = {
      socketId: socket.id,
      receivedAt: new Date().toISOString(),
    };

    let currentBroker: 'redis' | 'mq' = 'redis';

    try {
      await this.messageBusPort.publish('chat.v2.connection', payload);
      this.metricsService.incBrokerPublish('redis', 'ok', 'connection');

      currentBroker = 'mq';
      await this.eventPublisherPort.publish('chat.v2.connection.received', payload);
      this.metricsService.incBrokerPublish('mq', 'ok', 'connection');
    } catch (error) {
      this.metricsService.incBrokerPublish(currentBroker, 'fail', 'connection');
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
    @MessageBody() data: { roomId: string; message: string; senderId?: number },
    @ConnectedSocket() socket: Socket,
  ) {
    const payload = {
      messageId: randomUUID(),
      roomId: data.roomId,
      message: data.message,
      senderId: data.senderId,
      socketId: socket.id,
      receivedAt: new Date().toISOString(),
    };

    let currentBroker: 'redis' | 'mq' = 'redis';

    try {
      await this.messageBusPort.publish(`chat.v2.room.${data.roomId}`, payload);
      this.metricsService.incBrokerPublish('redis', 'ok', 'message');

      currentBroker = 'mq';
      await this.eventPublisherPort.publish('chat.v2.message.received', payload);
      this.metricsService.incBrokerPublish('mq', 'ok', 'message');
      this.metricsService.incV2MessageResult('accepted');

      socket.emit('v2_message_accepted', {
        roomId: data.roomId,
        accepted: true,
      });
    } catch (error) {
      this.metricsService.incBrokerPublish(currentBroker, 'fail', 'message');
      this.metricsService.incV2MessageResult('rejected', 'broker_unavailable');
      this.logger.warn(
        `v2 메시지 브로커 발행 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      socket.emit('v2_message_rejected', {
        roomId: data.roomId,
        accepted: false,
        reason: 'broker_unavailable',
      });
    }
  }
}
