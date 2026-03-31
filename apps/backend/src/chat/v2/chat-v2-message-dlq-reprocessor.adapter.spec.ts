import { ConfigService } from '@nestjs/config';
import { ChatV2MessageDlqReprocessorAdapter } from '@/chat/v2/chat-v2-message-dlq-reprocessor.adapter';

type MessageLike = {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
};

const createConfigService = (value: 'true' | 'false'): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'CHAT_USE_EXTERNAL_BROKERS') return value;
      if (key === 'RABBITMQ_V2_DLQ_REPROCESS_MAX_RETRIES') return '2';
      return defaultValue ?? '';
    }),
  }) as unknown as ConfigService;

describe('ChatV2MessageDlqReprocessorAdapter', () => {
  it('외부 브로커 비활성화면 연결하지 않는다', async () => {
    const configService = createConfigService('false');
    const connectFn = jest.fn();
    const adapter = new ChatV2MessageDlqReprocessorAdapter(configService, connectFn);

    await adapter.onModuleInit();

    expect(connectFn).not.toHaveBeenCalled();
  });

  it('DLQ 메시지는 한도 내에서 본 큐로 재투입한다', async () => {
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
    const connectFn = jest.fn().mockResolvedValue(connection);
    const adapter = new ChatV2MessageDlqReprocessorAdapter(configService, connectFn);

    await adapter.onModuleInit();

    const message = {
      content: Buffer.from(
        JSON.stringify({
          originalPayload: {
            messageId: 'm-1',
            roomId: '10',
            message: 'hello',
            socketId: 's-1',
            receivedAt: new Date().toISOString(),
          },
        }),
      ),
      properties: { headers: { 'x-dlq-retry-count': 1 } },
    };
    await consumeHandlers[0](message);

    expect(channel.publish).toHaveBeenCalledWith(
      'chat.events',
      'chat.v2.message.received',
      expect.any(Buffer),
      expect.objectContaining({
        headers: { 'x-retry-count': 0, 'x-dlq-retry-count': 2 },
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('DLQ 재처리 한도 초과 시 parking으로 이동한다', async () => {
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
    const connectFn = jest.fn().mockResolvedValue(connection);
    const adapter = new ChatV2MessageDlqReprocessorAdapter(configService, connectFn);

    await adapter.onModuleInit();

    const message = {
      content: Buffer.from(JSON.stringify({ originalPayload: { messageId: 'm-2' } })),
      properties: { headers: { 'x-dlq-retry-count': 2 } },
    };
    await consumeHandlers[0](message);

    expect(channel.publish).toHaveBeenCalledWith(
      'chat.events.dlx',
      'chat.v2.message.received.parking',
      message.content,
      expect.objectContaining({
        headers: { 'x-dlq-retry-count': 2 },
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
});
