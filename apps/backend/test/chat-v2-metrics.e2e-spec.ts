import { io, Socket } from 'socket.io-client';

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

async function fetchMetrics(backendUrl: string): Promise<string> {
  const response = await fetch(`${backendUrl}/metrics`);
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

describe('Chat v2 Metrics E2E', () => {
  const backendUrl = process.env.E2E_BACKEND_URL ?? 'http://127.0.0.1:3030';

  let socket: Socket;

  afterAll(() => {
    if (socket && socket.connected) {
      socket.disconnect();
    }
  });

  it('v2_message 성공 시 브로커/결과 메트릭이 증가한다', async () => {
    const messageMetricLabels: MessageMetricLabels = {
      result: 'accepted',
      reason: 'none',
    };
    const redisMessageMetricLabels: BrokerMetricLabels = {
      broker: 'redis',
      result: 'ok',
      route: 'message',
    };
    const mqMessageMetricLabels: BrokerMetricLabels = {
      broker: 'mq',
      result: 'ok',
      route: 'message',
    };

    const beforeMetrics = await fetchMetrics(backendUrl);
    const beforeRedisOk = extractCounter(
      beforeMetrics,
      'ws_broker_publish_total',
      redisMessageMetricLabels,
    );
    const beforeMqOk = extractCounter(
      beforeMetrics,
      'ws_broker_publish_total',
      mqMessageMetricLabels,
    );
    const beforeAccepted = extractCounter(
      beforeMetrics,
      'ws_v2_message_result_total',
      messageMetricLabels,
    );

    socket = io(`${backendUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });

    await waitForEvent(socket, 'v2_ready', 5000);

    const roomId = '10';
    const message = `hello-metrics-${Date.now()}`;
    const acceptedPromise = waitForEvent<{ roomId: string; accepted: boolean }>(
      socket,
      'v2_message_accepted',
      5000,
    );

    socket.emit('v2_message', { roomId, message });

    const ack = await acceptedPromise;
    expect(ack).toEqual({ roomId, accepted: true });

    await waitUntil(
      async () => {
        const afterMetrics = await fetchMetrics(backendUrl);
        const afterRedisOk = extractCounter(
          afterMetrics,
          'ws_broker_publish_total',
          redisMessageMetricLabels,
        );
        const afterMqOk = extractCounter(
          afterMetrics,
          'ws_broker_publish_total',
          mqMessageMetricLabels,
        );
        const afterAccepted = extractCounter(
          afterMetrics,
          'ws_v2_message_result_total',
          messageMetricLabels,
        );

        return (
          afterRedisOk >= beforeRedisOk + 1 &&
          afterMqOk >= beforeMqOk + 1 &&
          afterAccepted >= beforeAccepted + 1
        );
      },
      5000,
      200,
    );
  }, 20000);
});
