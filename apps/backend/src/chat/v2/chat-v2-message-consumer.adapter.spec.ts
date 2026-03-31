import { ConfigService } from '@nestjs/config';
import { ChatV2MessageConsumerAdapter } from '@/chat/v2/chat-v2-message-consumer.adapter';
import { ChatV2MessagePersistenceService } from '@/chat/v2/chat-v2-message-persistence.service';

type MessageLike = {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
};

const createConfigService = (value: 'true' | 'false'): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'CHAT_USE_EXTERNAL_BROKERS') return value;
      if (key === 'RABBITMQ_V2_CONSUMER_MAX_RETRIES') return '1';
      return defaultValue ?? '';
    }),
  }) as unknown as ConfigService;

describe('ChatV2MessageConsumerAdapter', () => {
  it('외부 브로커 비활성화면 연결을 시도하지 않는다', async () => {
    const configService = createConfigService('false');
    const persistenceService = { persist: jest.fn() } as unknown as ChatV2MessagePersistenceService;
    const connectFn = jest.fn();
    const adapter = new ChatV2MessageConsumerAdapter(configService, persistenceService, connectFn);

    await adapter.onModuleInit();

    expect(connectFn).not.toHaveBeenCalled();
  });

  it('메시지 저장 성공 시 ack 한다', async () => {
    const consumeHandlers: Array<(message: MessageLike | null) => void> = [];
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockImplementation(async (_queue, handler) => {
        consumeHandlers.push(handler);
      }),
      publish: jest.fn(),
      ack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      createChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const configService = createConfigService('true');
    const persistenceService = {
      persist: jest.fn().mockResolvedValue('saved'),
    } as unknown as ChatV2MessagePersistenceService;
    const connectFn = jest.fn().mockResolvedValue(connection);
    const adapter = new ChatV2MessageConsumerAdapter(configService, persistenceService, connectFn);

    await adapter.onModuleInit();
    const message = {
      content: Buffer.from(
        JSON.stringify({
          messageId: 'm-1',
          roomId: '10',
          message: 'hello',
          socketId: 's-1',
          receivedAt: new Date().toISOString(),
        }),
      ),
      properties: { headers: {} },
    };
    await consumeHandlers[0](message);

    expect(persistenceService.persist).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.publish).not.toHaveBeenCalled();
  });

  it('저장 실패 시 재시도 횟수 내면 재발행한다', async () => {
    const consumeHandlers: Array<(message: MessageLike | null) => void> = [];
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockImplementation(async (_queue, handler) => {
        consumeHandlers.push(handler);
      }),
      publish: jest.fn(),
      ack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      createChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const configService = createConfigService('true');
    const persistenceService = {
      persist: jest.fn().mockRejectedValue(new Error('db fail')),
    } as unknown as ChatV2MessagePersistenceService;
    const connectFn = jest.fn().mockResolvedValue(connection);
    const adapter = new ChatV2MessageConsumerAdapter(configService, persistenceService, connectFn);

    await adapter.onModuleInit();
    const message = {
      content: Buffer.from(
        JSON.stringify({
          messageId: 'm-2',
          roomId: '10',
          message: 'hello',
          socketId: 's-1',
          receivedAt: new Date().toISOString(),
        }),
      ),
      properties: { headers: {} },
    };
    await consumeHandlers[0](message);

    expect(channel.publish).toHaveBeenCalledWith(
      'chat.events',
      'chat.v2.message.received',
      message.content,
      expect.objectContaining({
        headers: { 'x-retry-count': 1 },
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('재시도 한도 초과 시 DLQ로 보낸다', async () => {
    const consumeHandlers: Array<(message: MessageLike | null) => void> = [];
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockImplementation(async (_queue, handler) => {
        consumeHandlers.push(handler);
      }),
      publish: jest.fn(),
      ack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      createChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const configService = createConfigService('true');
    const persistenceService = {
      persist: jest.fn().mockRejectedValue(new Error('db fail')),
    } as unknown as ChatV2MessagePersistenceService;
    const connectFn = jest.fn().mockResolvedValue(connection);
    const adapter = new ChatV2MessageConsumerAdapter(configService, persistenceService, connectFn);

    await adapter.onModuleInit();
    const message = {
      content: Buffer.from(
        JSON.stringify({
          messageId: 'm-3',
          roomId: '10',
          message: 'hello',
          socketId: 's-1',
          receivedAt: new Date().toISOString(),
        }),
      ),
      properties: { headers: { 'x-retry-count': 1 } },
    };
    await consumeHandlers[0](message);

    expect(channel.publish).toHaveBeenCalledWith(
      'chat.events.dlx',
      'chat.v2.message.received.dlq',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json',
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
});
