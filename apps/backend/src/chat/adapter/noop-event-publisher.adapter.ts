import { Injectable, Logger } from '@nestjs/common';
import { EventPublisherPort } from '@/chat/application/port';

@Injectable()
export class NoopEventPublisherAdapter implements EventPublisherPort {
  private readonly logger = new Logger(NoopEventPublisherAdapter.name);

  async publish(eventName: string, payload: unknown): Promise<void> {
    this.logger.debug(`No-op event publish: ${eventName} ${JSON.stringify(payload)}`);
  }
}
