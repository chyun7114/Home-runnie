import { ConfigService } from '@nestjs/config';
import { RabbitMqEventPublisherAdapter } from '@/chat/adapter/rabbitmq-event-publisher.adapter';

type ChannelMock = {
  assertExchange: jest.Mock<Promise<unknown>, [string, string, { durable: boolean }]>;
  publish: jest.Mock<
    boolean,
    [string, string, Buffer, { persistent: boolean; contentType: string }]
  >;
  close: jest.Mock<Promise<void>, []>;
};

type ConnectionMock = {
  createChannel: jest.Mock<Promise<ChannelMock>, []>;
  close: jest.Mock<Promise<void>, []>;
};

describe('RabbitMqEventPublisherAdapter', () => {
  const channelMock: ChannelMock = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockReturnValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const connectionMock: ConnectionMock = {
    createChannel: jest.fn().mockResolvedValue(channelMock),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        RABBITMQ_URL: 'amqp://localhost:5672',
        RABBITMQ_EXCHANGE: 'chat.events',
      };
      return values[key] ?? defaultValue ?? '';
    }),
  } as unknown as ConfigService;

  const connectFactory = jest.fn().mockResolvedValue(connectionMock);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('초기화 시 커넥션 생성 및 익스체인지 선언을 수행한다', async () => {
    const adapter = new RabbitMqEventPublisherAdapter(configServiceMock, connectFactory);

    await adapter.onModuleInit();

    expect(connectFactory).toHaveBeenCalledWith('amqp://localhost:5672');
    expect(connectionMock.createChannel).toHaveBeenCalledTimes(1);
    expect(channelMock.assertExchange).toHaveBeenCalledWith('chat.events', 'topic', {
      durable: true,
    });
  });

  it('publish 호출 시 이벤트를 익스체인지에 발행한다', async () => {
    const adapter = new RabbitMqEventPublisherAdapter(configServiceMock, connectFactory);
    await adapter.onModuleInit();

    await adapter.publish('chat.member.joined', { memberId: 1 });

    expect(channelMock.publish).toHaveBeenCalledWith(
      'chat.events',
      'chat.member.joined',
      Buffer.from(JSON.stringify({ memberId: 1 })),
      {
        persistent: true,
        contentType: 'application/json',
      },
    );
  });

  it('onModuleDestroy 호출 시 채널/커넥션을 종료한다', async () => {
    const adapter = new RabbitMqEventPublisherAdapter(configServiceMock, connectFactory);
    await adapter.onModuleInit();

    await adapter.onModuleDestroy();

    expect(channelMock.close).toHaveBeenCalledTimes(1);
    expect(connectionMock.close).toHaveBeenCalledTimes(1);
  });
});
