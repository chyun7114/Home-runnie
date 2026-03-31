import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { EVENT_PUBLISHER_PORT, MESSAGE_BUS_PORT } from '@/chat/application/port';
import { ChatRepository } from '@/chat/repository';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { MetricsService } from '@/metrics/metrics.service';

type GatewayTestContext = {
  app: INestApplication;
  baseUrl: string;
  messageBusMock: { publish: jest.Mock<Promise<void>, [string, unknown]> };
  eventPublisherMock: { publish: jest.Mock<Promise<void>, [string, unknown]> };
  chatRepositoryMock: {
    findMessagesAfterId: jest.Mock<Promise<unknown[]>, [number, number, number]>;
  };
};

async function createGatewayApp(options: {
  useExternalBrokers: 'true' | 'false';
  requireAuth?: 'true' | 'false';
}): Promise<GatewayTestContext> {
  const messageBusMock = { publish: jest.fn().mockResolvedValue(undefined) };
  const eventPublisherMock = { publish: jest.fn().mockResolvedValue(undefined) };
  const chatRepositoryMock = {
    findMessagesAfterId: jest.fn().mockResolvedValue([]),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ChatV2GatewayAdapter,
      { provide: MESSAGE_BUS_PORT, useValue: messageBusMock },
      { provide: EVENT_PUBLISHER_PORT, useValue: eventPublisherMock },
      { provide: ChatRepository, useValue: chatRepositoryMock },
      {
        provide: JwtService,
        useValue: { verifyAsync: jest.fn().mockResolvedValue({ memberId: 1 }) },
      },
      {
        provide: MetricsService,
        useValue: {
          incBrokerPublish: jest.fn(),
          incV2MessageResult: jest.fn(),
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string, defaultValue?: string) => {
            if (key === 'CHAT_USE_EXTERNAL_BROKERS') return options.useExternalBrokers;
            if (key === 'CHAT_V2_REQUIRE_AUTH') return options.requireAuth ?? 'false';
            if (key === 'JWT_SECRET') return 'test-secret';
            return defaultValue ?? '';
          }),
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as { port: number };
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    messageBusMock,
    eventPublisherMock,
    chatRepositoryMock,
  };
}

async function closeSocket(socket: Socket): Promise<void> {
  if (socket.connected) socket.disconnect();
}

describe('ChatV2GatewayAdapter 통합 테스트', () => {
  it('인증 필수 모드에서 토큰 없이 연결하면 v2_not_authorized를 수신한다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'true', requireAuth: 'true' });
    const socket = io(`${ctx.baseUrl}/ws-v2`, { transports: ['websocket'], reconnection: false });

    try {
      const payload = await new Promise<{ message: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_not_authorized timeout')), 3000);
        socket.on('v2_not_authorized', (message: { message: string }) => {
          clearTimeout(timer);
          resolve(message);
        });
      });

      expect(payload).toEqual({ message: '인증이 필요합니다.' });
      expect(ctx.messageBusMock.publish).not.toHaveBeenCalled();
      expect(ctx.eventPublisherMock.publish).not.toHaveBeenCalled();
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });

  it('인증 필수 모드에서 유효 토큰으로 연결하면 v2_ready를 수신한다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'true', requireAuth: 'true' });
    const socket = io(`${ctx.baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        Cookie: 'accessToken=valid-token',
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_ready timeout')), 3000);
        socket.on('v2_ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      expect(ctx.messageBusMock.publish).toHaveBeenCalledWith(
        'chat.v2.connection',
        expect.objectContaining({ socketId: expect.any(String) }),
      );
      expect(ctx.eventPublisherMock.publish).toHaveBeenCalledWith(
        'chat.v2.connection.received',
        expect.objectContaining({ socketId: expect.any(String) }),
      );
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });

  it('외부 브로커 활성화 시 v2_ready 후 v2_message_accepted를 수신한다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'true' });
    const socket = io(`${ctx.baseUrl}/ws-v2`, { transports: ['websocket'], reconnection: false });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_ready timeout')), 3000);
        socket.on('v2_ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      socket.emit('v2_message', { roomId: '10', message: 'hello' });

      const ack = await new Promise<{ roomId: string; accepted: boolean; sequence: number }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('v2_message_accepted timeout')), 3000);
          socket.on(
            'v2_message_accepted',
            (payload: { roomId: string; accepted: boolean; sequence: number }) => {
              clearTimeout(timer);
              resolve(payload);
            },
          );
        },
      );

      expect(ack).toEqual({ roomId: '10', accepted: true, sequence: 1 });
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });

  it('v2_recover 요청 시 gap 메시지를 수신한다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'true' });
    ctx.chatRepositoryMock.findMessagesAfterId.mockResolvedValueOnce([
      { id: 11, content: 'gap-1', senderId: 4, createdAt: new Date('2026-03-31T00:00:00.000Z') },
      { id: 12, content: 'gap-2', senderId: 5, createdAt: new Date('2026-03-31T00:00:01.000Z') },
    ]);

    const socket = io(`${ctx.baseUrl}/ws-v2`, { transports: ['websocket'], reconnection: false });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_ready timeout')), 3000);
        socket.on('v2_ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      socket.emit('v2_recover', { roomId: '10', lastMessageId: 10 });

      const payload = await new Promise<{
        roomId: string;
        fromMessageId: number;
        messages: Array<{ id: number; message: string; senderId: number }>;
      }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_gap_messages timeout')), 3000);
        socket.on('v2_gap_messages', (message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });

      expect(payload.roomId).toBe('10');
      expect(payload.fromMessageId).toBe(10);
      expect(payload.messages).toHaveLength(2);
      expect(payload.messages[0]).toEqual(
        expect.objectContaining({ id: 11, message: 'gap-1', senderId: 4 }),
      );
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });
});
