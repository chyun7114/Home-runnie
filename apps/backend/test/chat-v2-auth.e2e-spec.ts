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

describe('Chat v2 인증 E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let socket: Socket;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatV2GatewayAdapter,
        { provide: MESSAGE_BUS_PORT, useValue: { publish: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: EVENT_PUBLISHER_PORT,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: ChatRepository, useValue: { findMessagesAfterId: jest.fn().mockResolvedValue([]) } },
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
              if (key === 'CHAT_USE_EXTERNAL_BROKERS') return 'true';
              if (key === 'CHAT_V2_REQUIRE_AUTH') return 'true';
              if (key === 'JWT_SECRET') return 'test-secret';
              return defaultValue ?? '';
            }),
          },
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
    if (socket && socket.connected) socket.disconnect();
    if (app) await app.close();
  });

  it('토큰 없이 연결하면 v2_not_authorized를 수신한다', async () => {
    socket = io(`${baseUrl}/ws-v2`, { transports: ['websocket'], reconnection: false });

    const payload = await new Promise<{ message: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('v2_not_authorized timeout')), 5000);
      socket.on('v2_not_authorized', (message: { message: string }) => {
        clearTimeout(timer);
        resolve(message);
      });
    });

    expect(payload).toEqual({ message: '인증이 필요합니다.' });
  });

  it('유효 토큰으로 연결하면 v2_ready를 수신한다', async () => {
    socket = io(`${baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        Cookie: 'accessToken=valid-token',
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('v2_ready timeout')), 5000);
      socket.on('v2_ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});
