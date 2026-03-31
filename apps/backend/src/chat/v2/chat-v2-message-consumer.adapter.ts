import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { ChatV2MessagePersistenceService } from '@/chat/v2/chat-v2-message-persistence.service';
import { ChatV2MessageReceivedEvent } from '@/chat/v2/chat-v2-message-event';

type MessageLike = {
  content: Buffer;
  properties: {
    headers?: Record<string, unknown>;
  };
};

type ChannelLike = {
  assertExchange(exchange: string, type: string, options: { durable: boolean }): Promise<unknown>;
  assertQueue(queue: string, options: { durable: boolean }): Promise<unknown>;
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
  consume(
    queue: string,
    onMessage: (message: MessageLike | null) => void,
    options: { noAck: boolean },
  ): Promise<unknown>;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: {
      persistent: boolean;
      contentType: string;
      headers?: Record<string, unknown>;
    },
  ): boolean;
  ack(message: MessageLike): void;
  close(): Promise<void>;
};

type ConnectionLike = {
  createChannel(): Promise<ChannelLike>;
  close(): Promise<void>;
};

type ConnectFn = (url: string) => Promise<ConnectionLike>;

@Injectable()
export class ChatV2MessageConsumerAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatV2MessageConsumerAdapter.name);
  private readonly useExternalBrokers: boolean;
  private readonly amqpUrl: string;
  private readonly exchange: string;
  private readonly dlxExchange: string;
  private readonly queueName: string;
  private readonly routingKey: string;
  private readonly dlqRoutingKey: string;
  private readonly maxRetries: number;
  private readonly connectFn: ConnectFn;

  private connection: ConnectionLike | null = null;
  private channel: ChannelLike | null = null;

  constructor(
    configService: ConfigService,
    private readonly persistenceService: ChatV2MessagePersistenceService,
    connectFn?: ConnectFn,
  ) {
    this.useExternalBrokers =
      configService.get<string>('CHAT_USE_EXTERNAL_BROKERS', 'false') === 'true';
    this.amqpUrl = configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');
    this.exchange = configService.get<string>('RABBITMQ_EXCHANGE', 'chat.events');
    this.dlxExchange = configService.get<string>('RABBITMQ_DLX_EXCHANGE', 'chat.events.dlx');
    this.queueName = configService.get<string>(
      'RABBITMQ_V2_MESSAGE_QUEUE',
      'chat.v2.message.received.q',
    );
    this.routingKey = 'chat.v2.message.received';
    this.dlqRoutingKey = `${this.routingKey}.dlq`;
    this.maxRetries = Number(configService.get<string>('RABBITMQ_V2_CONSUMER_MAX_RETRIES', '3'));
    this.connectFn = connectFn ?? ((url: string) => connect(url) as Promise<ConnectionLike>);
  }

  async onModuleInit(): Promise<void> {
    if (!this.useExternalBrokers) {
      return;
    }

    this.connection = await this.connectFn(this.amqpUrl);
    this.channel = await this.connection.createChannel();

    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    await this.channel.assertExchange(this.dlxExchange, 'topic', { durable: true });
    await this.channel.assertQueue(this.queueName, { durable: true });
    await this.channel.assertQueue(`${this.queueName}.dlq`, { durable: true });
    await this.channel.bindQueue(this.queueName, this.exchange, this.routingKey);
    await this.channel.bindQueue(`${this.queueName}.dlq`, this.dlxExchange, this.dlqRoutingKey);

    await this.channel.consume(this.queueName, (message) => this.handleMessage(message), {
      noAck: false,
    });
  }

  private async handleMessage(message: MessageLike | null): Promise<void> {
    if (!message || !this.channel) {
      return;
    }

    let payload: ChatV2MessageReceivedEvent | null = null;
    try {
      payload = JSON.parse(message.content.toString('utf8')) as ChatV2MessageReceivedEvent;
      await this.persistenceService.persist(payload);
      this.channel.ack(message);
    } catch (error) {
      const retryCount = this.getRetryCount(message);

      if (retryCount < this.maxRetries) {
        this.channel.publish(this.exchange, this.routingKey, message.content, {
          persistent: true,
          contentType: 'application/json',
          headers: { 'x-retry-count': retryCount + 1 },
        });
      } else {
        const failedPayload = Buffer.from(
          JSON.stringify({
            failedAt: new Date().toISOString(),
            reason: error instanceof Error ? error.message : 'unknown error',
            retryCount,
            originalPayload: payload ?? message.content.toString('utf8'),
          }),
        );

        this.channel.publish(this.dlxExchange, this.dlqRoutingKey, failedPayload, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            'x-dlq-retry-count': message.properties.headers?.['x-dlq-retry-count'] ?? 0,
          },
        });

        this.logger.warn(
          `v2 message DLQ 이동: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }

      this.channel.ack(message);
    }
  }

  private getRetryCount(message: MessageLike): number {
    const retryCount = message.properties.headers?.['x-retry-count'];
    return typeof retryCount === 'number' ? retryCount : 0;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      this.logger.warn(
        `consumer resource close 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
}
