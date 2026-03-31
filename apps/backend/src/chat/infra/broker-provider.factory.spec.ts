import { ConfigService } from '@nestjs/config';
import {
  createEventPublisherAdapter,
  createMessageDedupAdapter,
  createMessageBusAdapter,
} from '@/chat/infra/broker-provider.factory';
import {
  InMemoryMessageDedupAdapter,
  NoopEventPublisherAdapter,
  NoopMessageBusAdapter,
  RabbitMqEventPublisherAdapter,
  RedisMessageDedupAdapter,
  RedisMessageBusAdapter,
} from '@/chat/adapter';

function createConfigService(value: 'true' | 'false'): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'CHAT_USE_EXTERNAL_BROKERS') {
        return value;
      }
      return defaultValue ?? '';
    }),
  } as unknown as ConfigService;
}

describe('broker-provider.factory', () => {
  it('외부 브로커 비활성화면 Noop MessageBus를 반환한다', () => {
    const configService = createConfigService('false');
    const noopAdapter = new NoopMessageBusAdapter();

    const adapter = createMessageBusAdapter(configService, {
      createExternal: () => new RedisMessageBusAdapter(configService),
      createNoop: () => noopAdapter,
    });

    expect(adapter).toBe(noopAdapter);
  });

  it('외부 브로커 활성화면 Redis MessageBus를 반환한다', () => {
    const configService = createConfigService('true');
    const externalAdapter = { publish: jest.fn() };

    const adapter = createMessageBusAdapter(configService, {
      createExternal: () => externalAdapter,
      createNoop: () => new NoopMessageBusAdapter(),
    });

    expect(adapter).toBe(externalAdapter);
  });

  it('외부 브로커 비활성화면 Noop EventPublisher를 반환한다', () => {
    const configService = createConfigService('false');
    const noopAdapter = new NoopEventPublisherAdapter();

    const adapter = createEventPublisherAdapter(configService, {
      createExternal: () => new RabbitMqEventPublisherAdapter(configService),
      createNoop: () => noopAdapter,
    });

    expect(adapter).toBe(noopAdapter);
  });

  it('외부 브로커 활성화면 RabbitMQ EventPublisher를 반환한다', () => {
    const configService = createConfigService('true');
    const externalAdapter = { publish: jest.fn() };

    const adapter = createEventPublisherAdapter(configService, {
      createExternal: () => externalAdapter,
      createNoop: () => new NoopEventPublisherAdapter(),
    });

    expect(adapter).toBe(externalAdapter);
  });

  it('외부 브로커 비활성화면 InMemory 멱등 어댑터를 반환한다', () => {
    const configService = createConfigService('false');
    const inMemoryAdapter = new InMemoryMessageDedupAdapter();

    const adapter = createMessageDedupAdapter(configService, {
      createExternal: () => new RedisMessageDedupAdapter(configService),
      createInMemory: () => inMemoryAdapter,
    });

    expect(adapter).toBe(inMemoryAdapter);
  });

  it('외부 브로커 활성화면 Redis 멱등 어댑터를 반환한다', () => {
    const configService = createConfigService('true');
    const externalAdapter = { reserve: jest.fn() };

    const adapter = createMessageDedupAdapter(configService, {
      createExternal: () => externalAdapter,
      createInMemory: () => new InMemoryMessageDedupAdapter(),
    });

    expect(adapter).toBe(externalAdapter);
  });
});
