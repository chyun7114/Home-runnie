import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { EVENT_PUBLISHER_PORT, MESSAGE_BUS_PORT } from '@/chat/application/port';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { MetricsService } from '@/metrics/metrics.service';

type GatewayTestContext = {
  app: INestApplication;
  baseUrl: string;
  messageBusMock: { publish: jest.Mock<Promise<void>, [string, unknown]> };
  eventPublisherMock: { publish: jest.Mock<Promise<void>, [string, unknown]> };
};

async function createGatewayApp(options: {
  useExternalBrokers: 'true' | 'false';
  requireAuth?: 'true' | 'false';
}): Promise<GatewayTestContext> {
  const messageBusMock = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const eventPublisherMock = {
    publish: jest.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ChatV2GatewayAdapter,
      { provide: MESSAGE_BUS_PORT, useValue: messageBusMock },
      { provide: EVENT_PUBLISHER_PORT, useValue: eventPublisherMock },
      {
        provide: JwtService,
        useValue: {
          verifyAsync: jest.fn().mockResolvedValue({ memberId: 1 }),
        },
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
            if (key === 'CHAT_USE_EXTERNAL_BROKERS') {
              return options.useExternalBrokers;
            }
            if (key === 'CHAT_V2_REQUIRE_AUTH') {
              return options.requireAuth ?? 'false';
            }
            if (key === 'JWT_SECRET') {
              return 'test-secret';
            }
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
  };
}

async function closeSocket(socket: Socket): Promise<void> {
  if (socket.connected) {
    socket.disconnect();
  }
}

describe('ChatV2GatewayAdapter 통합 테스트', () => {
  it('외부 브로커 비활성화 시 v2_not_ready를 받고 연결이 종료된다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'false' });
    const socket = io(`${ctx.baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
    });
    let disconnected = false;
    socket.on('disconnect', () => {
      disconnected = true;
    });

    try {
      const notReady = await new Promise<{ message: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_not_ready timeout')), 3000);
        socket.on('v2_not_ready', (payload: { message: string }) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(notReady.message).toBe('v2 채팅 스켈레톤 단계입니다.');
      expect(disconnected || socket.connected === false).toBe(true);
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });

  it('인증 필수 모드에서 토큰이 없으면 v2_not_authorized를 수신한다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'true', requireAuth: 'true' });
    const socket = io(`${ctx.baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      const notAuthorized = await new Promise<{ message: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_not_authorized timeout')), 3000);
        socket.on('v2_not_authorized', (payload: { message: string }) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      expect(notAuthorized).toEqual({ message: '인증이 필요합니다.' });
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });

  it('외부 브로커 활성화 시 v2_ready 후 v2_message_accepted를 수신한다', async () => {
    const ctx = await createGatewayApp({ useExternalBrokers: 'true' });
    const socket = io(`${ctx.baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_ready timeout')), 3000);
        socket.on('v2_ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      socket.emit('v2_message', { roomId: '10', message: 'hello' });

      const ack = await new Promise<{ roomId: string; accepted: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_message_accepted timeout')), 3000);
        socket.on('v2_message_accepted', (payload: { roomId: string; accepted: boolean }) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      expect(ack).toEqual({ roomId: '10', accepted: true });
    } finally {
      await closeSocket(socket);
      await ctx.app.close();
    }
  });
});
