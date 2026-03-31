import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';

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
export const AMQP_DLX_CONNECT_FN = Symbol('AMQP_DLX_CONNECT_FN');

@Injectable()
export class ChatV2MessageDlqReprocessorAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatV2MessageDlqReprocessorAdapter.name);
  private readonly useExternalBrokers: boolean;
  private readonly amqpUrl: string;
  private readonly exchange: string;
  private readonly dlxExchange: string;
  private readonly queueName: string;
  private readonly routingKey: string;
  private readonly dlqRoutingKey: string;
  private readonly parkingRoutingKey: string;
  private readonly maxDlqRetries: number;
  private readonly reprocessEnabled: boolean;
  private readonly connectFn: ConnectFn;

  private connection: ConnectionLike | null = null;
  private channel: ChannelLike | null = null;

  constructor(
    configService: ConfigService,
    @Optional() @Inject(AMQP_DLX_CONNECT_FN) connectFn?: ConnectFn,
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
    this.parkingRoutingKey = `${this.routingKey}.parking`;
    this.maxDlqRetries = Number(
      configService.get<string>('RABBITMQ_V2_DLQ_REPROCESS_MAX_RETRIES', '2'),
    );
    this.reprocessEnabled =
      configService.get<string>('CHAT_V2_DLQ_REPROCESS_ENABLED', 'true') === 'true';
    this.connectFn = connectFn ?? ((url: string) => connect(url) as Promise<ConnectionLike>);
  }

  async onModuleInit(): Promise<void> {
    if (!this.useExternalBrokers || !this.reprocessEnabled) {
      return;
    }

    this.connection = await this.connectFn(this.amqpUrl);
    this.channel = await this.connection.createChannel();

    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    await this.channel.assertExchange(this.dlxExchange, 'topic', { durable: true });
    await this.channel.assertQueue(`${this.queueName}.dlq`, { durable: true });
    await this.channel.assertQueue(`${this.queueName}.parking`, { durable: true });
    await this.channel.bindQueue(`${this.queueName}.dlq`, this.dlxExchange, this.dlqRoutingKey);
    await this.channel.bindQueue(
      `${this.queueName}.parking`,
      this.dlxExchange,
      this.parkingRoutingKey,
    );

    await this.channel.consume(
      `${this.queueName}.dlq`,
      (message) => this.handleDlqMessage(message),
      {
        noAck: false,
      },
    );
  }

  private async handleDlqMessage(message: MessageLike | null): Promise<void> {
    if (!message || !this.channel) {
      return;
    }

    try {
      const dlqRetryCount = this.getDlqRetryCount(message);
      if (dlqRetryCount < this.maxDlqRetries) {
        const replayPayload = this.extractReplayPayload(message.content);

        this.channel.publish(this.exchange, this.routingKey, replayPayload, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            'x-retry-count': 0,
            'x-dlq-retry-count': dlqRetryCount + 1,
          },
        });
      } else {
        this.channel.publish(this.dlxExchange, this.parkingRoutingKey, message.content, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            'x-dlq-retry-count': dlqRetryCount,
          },
        });

        this.logger.warn(`v2 DLQ 재처리 한도 초과로 parking 이동: retry=${dlqRetryCount}`);
      }
    } catch (error) {
      this.logger.warn(
        `v2 DLQ 재처리 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      this.channel.publish(this.dlxExchange, this.parkingRoutingKey, message.content, {
        persistent: true,
        contentType: 'application/json',
        headers: {
          'x-dlq-retry-count': this.getDlqRetryCount(message),
        },
      });
    } finally {
      this.channel.ack(message);
    }
  }

  private extractReplayPayload(content: Buffer): Buffer {
    const parsed = JSON.parse(content.toString('utf8')) as {
      originalPayload?: unknown;
    };
    const replay = parsed?.originalPayload ?? parsed;
    const normalized =
      typeof replay === 'string' ? (JSON.parse(replay) as Record<string, unknown>) : replay;
    return Buffer.from(JSON.stringify(normalized));
  }

  private getDlqRetryCount(message: MessageLike): number {
    const retryCount = message.properties.headers?.['x-dlq-retry-count'];
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
        `dlq reprocessor close 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
}
