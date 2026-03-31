import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import {
  EVENT_PUBLISHER_PORT,
  MESSAGE_BUS_PORT,
  EventPublisherPort,
  MessageBusPort,
} from '@/chat/application/port';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { MetricsModule } from '@/metrics';

type BrokerMetricLabels = {
  broker: 'redis' | 'mq';
  result: 'ok' | 'fail';
  route: 'connection' | 'message';
};

type MessageMetricLabels = {
  result: 'accepted' | 'rejected';
  reason: 'none' | 'broker_unavailable';
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCounter(
  metricsText: string,
  metricName: string,
  labels: Record<string, string>,
): number {
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(',');
  const pattern = new RegExp(
    `^${escapeRegExp(metricName)}\\{${escapeRegExp(labelText)}\\}\\s+([0-9]+(?:\\.[0-9]+)?)$`,
    'm',
  );
  const matched = metricsText.match(pattern);
  if (!matched) {
    return 0;
  }
  return Number(matched[1]);
}

async function fetchMetrics(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/metrics`);
  if (!response.ok) {
    throw new Error(`metrics fetch failed: ${response.status}`);
  }
  return response.text();
}

async function waitForEvent<T>(socket: Socket, eventName: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${eventName} timeout`)), timeoutMs);
    socket.on(eventName, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('condition timeout');
}

describe('Chat v2 실패 메트릭 E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let socket: Socket;

  beforeAll(async () => {
    const messageBusMock: MessageBusPort = {
      publish: jest.fn(async (channel: string) => {
        if (channel.startsWith('chat.v2.room.')) {
          throw new Error('redis down');
        }
      }),
    };

    const eventPublisherMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule],
      providers: [
        ChatV2GatewayAdapter,
        { provide: MESSAGE_BUS_PORT, useValue: messageBusMock },
        { provide: EVENT_PUBLISHER_PORT, useValue: eventPublisherMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'CHAT_USE_EXTERNAL_BROKERS') {
                return 'true';
              }
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
    if (socket && socket.connected) {
      socket.disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  it('v2_message 실패 시 rejected 및 fail 메트릭이 증가한다', async () => {
    const messageMetricLabels: MessageMetricLabels = {
      result: 'rejected',
      reason: 'broker_unavailable',
    };
    const redisFailMetricLabels: BrokerMetricLabels = {
      broker: 'redis',
      result: 'fail',
      route: 'message',
    };

    const beforeMetrics = await fetchMetrics(baseUrl);
    const beforeRejected = extractCounter(
      beforeMetrics,
      'ws_v2_message_result_total',
      messageMetricLabels,
    );
    const beforeRedisFail = extractCounter(
      beforeMetrics,
      'ws_broker_publish_total',
      redisFailMetricLabels,
    );

    socket = io(`${baseUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });

    await waitForEvent(socket, 'v2_ready', 5000);

    const roomId = '11';
    socket.emit('v2_message', { roomId, message: `fail-metrics-${Date.now()}` });

    const rejected = await waitForEvent<{ roomId: string; accepted: boolean; reason: string }>(
      socket,
      'v2_message_rejected',
      5000,
    );

    expect(rejected).toEqual({
      roomId,
      accepted: false,
      reason: 'broker_unavailable',
    });

    await waitUntil(
      async () => {
        const afterMetrics = await fetchMetrics(baseUrl);
        const afterRejected = extractCounter(
          afterMetrics,
          'ws_v2_message_result_total',
          messageMetricLabels,
        );
        const afterRedisFail = extractCounter(
          afterMetrics,
          'ws_broker_publish_total',
          redisFailMetricLabels,
        );

        return afterRejected >= beforeRejected + 1 && afterRedisFail >= beforeRedisFail + 1;
      },
      5000,
      200,
    );
  }, 20000);
});
