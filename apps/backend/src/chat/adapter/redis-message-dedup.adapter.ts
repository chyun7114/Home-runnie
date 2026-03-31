import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { MessageDedupPort } from '@/chat/application/port';

@Injectable()
export class RedisMessageDedupAdapter implements MessageDedupPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisMessageDedupAdapter.name);
  private readonly redisUrl: string;
  private readonly keyTtlSeconds: number;
  private redis: Redis | null = null;

  constructor(configService: ConfigService) {
    this.redisUrl = configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.keyTtlSeconds = Number(
      configService.get<string>('CHAT_V2_MESSAGE_ID_TTL_SECONDS', '3600'),
    );
  }

  async onModuleInit(): Promise<void> {
    this.redis = new Redis(this.redisUrl);
  }

  async reserve(messageId: string): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Redis dedup client is not initialized');
    }
    const result = await this.redis.set(
      `chat:v2:dedup:${messageId}`,
      '1',
      'EX',
      this.keyTtlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.quit();
      }
    } catch (error) {
      this.logger.warn(
        `redis dedup close 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.redis = null;
    }
  }
}
