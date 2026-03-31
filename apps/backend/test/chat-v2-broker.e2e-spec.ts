import * as amqp from 'amqplib';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';

describe('Chat v2 브로커 연동 E2E', () => {
  const backendUrl = process.env.E2E_BACKEND_URL ?? 'http://127.0.0.1:3030';
  const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const rabbitUrl = process.env.E2E_RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672';
  const exchange = process.env.E2E_RABBITMQ_EXCHANGE ?? 'chat.events';

  const roomId = '10';
  const testMessage = `hello-broker-${Date.now()}`;
  const redisChannel = `chat.v2.room.${roomId}`;
  const rabbitRoutingKey = 'chat.v2.message.received';

  let redisSubscriber: Redis;
  let rabbitConnection: amqp.ChannelModel;
  let rabbitChannel: amqp.Channel;
  let socket: Socket;

  beforeAll(async () => {
    redisSubscriber = new Redis(redisUrl);
    await redisSubscriber.subscribe(redisChannel);

    rabbitConnection = await amqp.connect(rabbitUrl);
    rabbitChannel = await rabbitConnection.createChannel();
    await rabbitChannel.assertExchange(exchange, 'topic', { durable: true });
  });

  afterAll(async () => {
    try {
      if (socket && socket.connected) {
        socket.disconnect();
      }
      if (rabbitChannel) {
        await rabbitChannel.close();
      }
      if (rabbitConnection) {
        await rabbitConnection.close();
      }
      if (redisSubscriber) {
        await redisSubscriber.quit();
      }
    } catch {
      // 종료 시점 예외는 테스트 결과에 영향 주지 않는다.
    }
  });

  it('v2_message 전송 시 Redis/RabbitMQ 모두 발행되어야 한다', async () => {
    const queue = await rabbitChannel.assertQueue('', { exclusive: true, autoDelete: true });
    await rabbitChannel.bindQueue(queue.queue, exchange, rabbitRoutingKey);

    socket = io(`${backendUrl}/ws-v2`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('v2_ready timeout')), 5000);
      socket.on('v2_ready', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('v2_not_ready', () => {
        clearTimeout(timer);
        reject(new Error('v2_not_ready received'));
      });
      socket.on('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const redisPayloadPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('redis publish timeout')), 5000);
      redisSubscriber.on('message', (channel, message) => {
        if (channel !== redisChannel) return;
        clearTimeout(timer);
        resolve(JSON.parse(message) as Record<string, unknown>);
      });
    });

    const rabbitPayloadPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('rabbit publish timeout')), 5000);
      rabbitChannel.consume(
        queue.queue,
        (msg) => {
          if (!msg) return;
          clearTimeout(timer);
          const payload = JSON.parse(msg.content.toString('utf8')) as Record<string, unknown>;
          rabbitChannel.ack(msg);
          resolve(payload);
        },
        { noAck: false },
      );
    });

    const ackPromise = new Promise<{ roomId: string; accepted: boolean; sequence: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('v2_message_accepted timeout')), 5000);
        socket.on(
          'v2_message_accepted',
          (payload: { roomId: string; accepted: boolean; sequence: number }) => {
            clearTimeout(timer);
            resolve(payload);
          },
        );
      },
    );

    socket.emit('v2_message', { roomId, message: testMessage });

    const [ack, redisPayload, rabbitPayload] = await Promise.all([
      ackPromise,
      redisPayloadPromise,
      rabbitPayloadPromise,
    ]);

    expect(ack).toEqual(
      expect.objectContaining({
        roomId,
        accepted: true,
      }),
    );
    expect(redisPayload).toEqual(
      expect.objectContaining({
        roomId,
        message: testMessage,
      }),
    );
    expect(rabbitPayload).toEqual(
      expect.objectContaining({
        roomId,
        message: testMessage,
      }),
    );
  });
});
