import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { EVENT_PUBLISHER_PORT, MESSAGE_BUS_PORT } from '@/chat/application/port';
import { ChatGateway } from '@/chat/chat.gateway';
import { ChatRepository } from '@/chat/repository';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { MemberRepository } from '@/member/repository';
import { MetricsService } from '@/metrics/metrics.service';

type EventLikeSocket = Socket & { connected: boolean };

async function waitForEvent<T>(socket: EventLikeSocket, eventName: string, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${eventName} timeout`)), timeoutMs);
    socket.on(eventName, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('v2 장애 중 v1 회귀 E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let v1Socket: EventLikeSocket;
  let v2Socket: EventLikeSocket;

  const messageBusMock = { publish: jest.fn().mockResolvedValue(undefined) };
  const eventPublisherMock = {
    publish: jest.fn(async (routingKey: string) => {
      if (routingKey === 'chat.v2.message.received') {
        throw new Error('mq down');
      }
    }),
  };
  const chatRepositoryMock = {
    findChatRoomById: jest.fn().mockResolvedValue({ id: 10 }),
    updateLastReadAt: jest.fn().mockResolvedValue(undefined),
    findMessagesByRoomId: jest.fn().mockResolvedValue([]),
    saveMessage: jest.fn().mockResolvedValue(undefined),
    updateChatRoomUpdatedAt: jest.fn().mockResolvedValue(undefined),
    findMessagesAfterId: jest.fn().mockResolvedValue([]),
  };
  const memberRepositoryMock = {
    findMemberWithProfile: jest.fn().mockResolvedValue([
      {
        profile: {
          nickname: 'tester',
          supportTeam: null,
        },
      },
    ]),
  };
  const metricsServiceMock = {
    onSocketConnected: jest.fn(),
    onSocketDisconnected: jest.fn(),
    setActiveRoomCount: jest.fn(),
    observeHandshake: jest.fn(),
    observeJoin: jest.fn(),
    observeMessage: jest.fn(),
    measureDbQuery: jest.fn(async (_queryType: string, fn: () => Promise<unknown>) => fn()),
    incFailure: jest.fn(),
    incPendingMessage: jest.fn(),
    decPendingMessage: jest.fn(),
    incBrokerPublish: jest.fn(),
    incV2MessageResult: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatGateway,
        ChatV2GatewayAdapter,
        { provide: MESSAGE_BUS_PORT, useValue: messageBusMock },
        { provide: EVENT_PUBLISHER_PORT, useValue: eventPublisherMock },
        { provide: ChatRepository, useValue: chatRepositoryMock },
        { provide: MemberRepository, useValue: memberRepositoryMock },
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn().mockResolvedValue({ memberId: 1 }) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'CHAT_USE_EXTERNAL_BROKERS') return 'true';
              if (key === 'CHAT_V2_REQUIRE_AUTH') return 'false';
              if (key === 'JWT_SECRET') return 'test-secret';
              return defaultValue ?? '';
            }),
          },
        },
        {
          provide: MetricsService,
          useValue: metricsServiceMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (v1Socket?.connected) v1Socket.disconnect();
    if (v2Socket?.connected) v2Socket.disconnect();
    if (app) await app.close();
  });

  it('v2 메시지 실패가 발생해도 v1 join/message는 정상 동작한다', async () => {
    v2Socket = io(`${baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    }) as EventLikeSocket;

    await waitForEvent(v2Socket, 'v2_ready');
    v2Socket.emit('v2_message', { roomId: '10', message: 'v2-fail-case' });

    const rejected = await waitForEvent<{ roomId: string; accepted: boolean; reason: string }>(
      v2Socket,
      'v2_message_rejected',
    );

    expect(rejected).toEqual({
      roomId: '10',
      accepted: false,
      reason: 'broker_unavailable',
    });

    v1Socket = io(`${baseUrl}/chat`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
      extraHeaders: {
        Cookie: 'accessToken=valid-token',
      },
    }) as EventLikeSocket;

    await waitForEvent(v1Socket, 'authenticated');

    v1Socket.emit('join_room', { roomId: '10' });
    await waitForEvent(v1Socket, 'message_history');

    const v1Message = `v1-still-works-${Date.now()}`;
    v1Socket.emit('message', { roomId: '10', message: v1Message });

    const received = await waitForEvent<{
      roomId: string;
      message: string;
      isOwn: boolean;
      nickname: string;
    }>(v1Socket, 'received_message');

    expect(received).toEqual(
      expect.objectContaining({
        roomId: '10',
        message: v1Message,
        isOwn: true,
        nickname: 'tester',
      }),
    );

    expect(chatRepositoryMock.saveMessage).toHaveBeenCalledWith(10, 1, v1Message);
    expect(eventPublisherMock.publish).toHaveBeenCalledWith(
      'chat.v2.message.received',
      expect.objectContaining({ roomId: '10' }),
    );
  });
});
