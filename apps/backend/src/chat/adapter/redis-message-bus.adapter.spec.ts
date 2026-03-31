import { ConfigService } from '@nestjs/config';
import { RedisMessageBusAdapter } from '@/chat/adapter/redis-message-bus.adapter';

type RedisClientMock = {
  publish: jest.Mock<Promise<number>, [string, string]>;
  quit: jest.Mock<Promise<'OK'>, []>;
};

describe('RedisMessageBusAdapter', () => {
  const redisClientMock: RedisClientMock = {
    publish: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
  };

  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
        REDIS_PASSWORD: '',
      };
      return values[key] ?? defaultValue ?? '';
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publish 호출 시 채널과 직렬화된 payload를 전달한다', async () => {
    const adapter = new RedisMessageBusAdapter(configServiceMock, redisClientMock);

    await adapter.publish('chat.room.1', { message: 'hello' });

    expect(redisClientMock.publish).toHaveBeenCalledWith(
      'chat.room.1',
      JSON.stringify({ message: 'hello' }),
    );
  });

  it('onModuleDestroy 호출 시 redis quit을 수행한다', async () => {
    const adapter = new RedisMessageBusAdapter(configServiceMock, redisClientMock);

    await adapter.onModuleDestroy();

    expect(redisClientMock.quit).toHaveBeenCalledTimes(1);
  });
});
