import { Injectable, Logger } from '@nestjs/common';
import { MessageBusPort } from '@/chat/application/port';

@Injectable()
export class NoopMessageBusAdapter implements MessageBusPort {
  private readonly logger = new Logger(NoopMessageBusAdapter.name);

  async publish(channel: string, payload: unknown): Promise<void> {
    this.logger.debug(`No-op message bus publish: ${channel} ${JSON.stringify(payload)}`);
  }
}
