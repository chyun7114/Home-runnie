import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { MessageBusPort } from '@/chat/application/port';

type RedisLikeClient = {
  publish(channel: string, message: string): Promise<number>;
  quit(): Promise<'OK' | string>;
};

@Injectable()
export class RedisMessageBusAdapter implements MessageBusPort, OnModuleDestroy {
  private readonly logger = new Logger(RedisMessageBusAdapter.name);
  private readonly client: RedisLikeClient;

  constructor(configService: ConfigService, client?: RedisLikeClient) {
    this.client =
      client ??
      new Redis({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: Number(configService.get<string>('REDIS_PORT', '6379')),
        password: configService.get<string>('REDIS_PASSWORD') || undefined,
      });
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(
        `redis client quit 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
