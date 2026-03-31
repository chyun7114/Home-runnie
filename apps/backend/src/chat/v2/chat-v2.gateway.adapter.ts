import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import { Socket } from 'socket.io';
import { JwtPayload } from '@/auth/types';
import { ChatRepository } from '@/chat/repository';
import {
  EVENT_PUBLISHER_PORT,
  EventPublisherPort,
  MESSAGE_BUS_PORT,
  MessageBusPort,
} from '@/chat/application/port';
import { extractTokenFromSocket } from '@/chat/ws-jwt.guard';
import { CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';
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
    private readonly chatRepository: ChatRepository,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly metricsService: MetricsService,
  ) {}

  async handleConnection(socket: Socket) {
    if (this.isAuthRequired()) {
      const memberId = await this.authenticate(socket);
      if (!memberId) {
        socket.emit('v2_not_authorized', {
          message: '인증이 필요합니다.',
        });
        socket.disconnect();
        return;
      }
      socket.data.v2MemberId = memberId;
    }

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
    if (this.isAuthRequired() && !socket.data?.v2MemberId) {
      socket.emit('v2_message_rejected', {
        roomId: data.roomId,
        accepted: false,
        reason: 'unauthorized',
      });
      return;
    }
    if (!this.isValidPayload(data)) {
      socket.emit('v2_message_rejected', {
        roomId: data.roomId,
        accepted: false,
        reason: 'invalid_payload',
      });
      return;
    }

    const payload = {
      messageId: randomUUID(),
      roomId: data.roomId,
      message: data.message.trim(),
      senderId: socket.data?.v2MemberId ?? data.senderId,
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

  @SubscribeMessage('v2_recover')
  async handleV2Recover(
    @MessageBody() data: { roomId: string; lastMessageId: number },
    @ConnectedSocket() socket: Socket,
  ) {
    if (this.isAuthRequired() && !socket.data?.v2MemberId) {
      socket.emit('v2_recover_failed', {
        roomId: data.roomId,
        reason: 'unauthorized',
      });
      return;
    }
    const roomId = Number(data.roomId);
    const lastMessageId = Number(data.lastMessageId);
    if (Number.isNaN(roomId) || roomId <= 0 || Number.isNaN(lastMessageId) || lastMessageId < 0) {
      socket.emit('v2_recover_failed', {
        roomId: data.roomId,
        reason: 'invalid_payload',
      });
      return;
    }

    const gapMessages = await this.chatRepository.findMessagesAfterId(roomId, lastMessageId, 100);
    socket.emit('v2_gap_messages', {
      roomId: data.roomId,
      fromMessageId: lastMessageId,
      messages: gapMessages.map((message) => ({
        id: message.id,
        message: message.content,
        senderId: message.senderId,
        createdAt: message.createdAt,
      })),
    });
  }

  private isAuthRequired(): boolean {
    return this.configService.get<string>('CHAT_V2_REQUIRE_AUTH', 'false') === 'true';
  }

  private async authenticate(socket: Socket): Promise<number | null> {
    try {
      const token = extractTokenFromSocket(socket);
      if (!token) {
        return null;
      }
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      return payload.memberId;
    } catch {
      return null;
    }
  }

  private isValidPayload(data: { roomId: string; message: string }): boolean {
    const roomId = Number(data.roomId);
    if (Number.isNaN(roomId) || roomId <= 0) {
      return false;
    }
    const message = data.message?.trim();
    return typeof message === 'string' && message.length > 0 && message.length <= 1000;
  }
}
