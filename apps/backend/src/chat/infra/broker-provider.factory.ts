import { ConfigService } from '@nestjs/config';
import { EventPublisherPort, MessageBusPort } from '@/chat/application/port';
import {
  NoopEventPublisherAdapter,
  NoopMessageBusAdapter,
  RabbitMqEventPublisherAdapter,
  RedisMessageBusAdapter,
} from '@/chat/adapter';

function shouldUseExternalBrokers(configService: ConfigService): boolean {
  return configService.get<string>('CHAT_USE_EXTERNAL_BROKERS', 'false') === 'true';
}

type MessageBusAdapterCreators = {
  createExternal: (configService: ConfigService) => MessageBusPort;
  createNoop: () => MessageBusPort;
};

type EventPublisherAdapterCreators = {
  createExternal: (configService: ConfigService) => EventPublisherPort;
  createNoop: () => EventPublisherPort;
};

const defaultMessageBusCreators: MessageBusAdapterCreators = {
  createExternal: (configService) => new RedisMessageBusAdapter(configService),
  createNoop: () => new NoopMessageBusAdapter(),
};

const defaultEventPublisherCreators: EventPublisherAdapterCreators = {
  createExternal: (configService) => new RabbitMqEventPublisherAdapter(configService),
  createNoop: () => new NoopEventPublisherAdapter(),
};

export function createMessageBusAdapter(
  configService: ConfigService,
  creators: MessageBusAdapterCreators = defaultMessageBusCreators,
): MessageBusPort {
  if (shouldUseExternalBrokers(configService)) {
    return creators.createExternal(configService);
  }
  return creators.createNoop();
}

export function createEventPublisherAdapter(
  configService: ConfigService,
  creators: EventPublisherAdapterCreators = defaultEventPublisherCreators,
): EventPublisherPort {
  if (shouldUseExternalBrokers(configService)) {
    return creators.createExternal(configService);
  }
  return creators.createNoop();
}
