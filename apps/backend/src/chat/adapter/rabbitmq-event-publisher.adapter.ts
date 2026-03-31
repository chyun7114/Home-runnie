import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { EventPublisherPort } from '@/chat/application/port';

type ChannelLike = {
  assertExchange(exchange: string, type: string, options: { durable: boolean }): Promise<unknown>;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: { persistent: boolean; contentType: string },
  ): boolean;
  close(): Promise<void>;
};

type ConnectionLike = {
  createChannel(): Promise<ChannelLike>;
  close(): Promise<void>;
};

type ConnectFn = (url: string) => Promise<ConnectionLike>;

@Injectable()
export class RabbitMqEventPublisherAdapter
  implements EventPublisherPort, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RabbitMqEventPublisherAdapter.name);
  private readonly amqpUrl: string;
  private readonly exchange: string;
  private readonly connectFn: ConnectFn;

  private connection: ConnectionLike | null = null;
  private channel: ChannelLike | null = null;

  constructor(configService: ConfigService, connectFn?: ConnectFn) {
    this.amqpUrl = configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');
    this.exchange = configService.get<string>('RABBITMQ_EXCHANGE', 'chat.events');
    this.connectFn = connectFn ?? ((url: string) => connect(url) as Promise<ConnectionLike>);
  }

  async onModuleInit(): Promise<void> {
    this.connection = await this.connectFn(this.amqpUrl);
    const channel = await this.connection.createChannel();
    await channel.assertExchange(this.exchange, 'topic', { durable: true });
    this.channel = channel;
  }

  async publish(eventName: string, payload: unknown): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }

    this.channel.publish(this.exchange, eventName, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    });
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
        `rabbitmq resource close 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
}
