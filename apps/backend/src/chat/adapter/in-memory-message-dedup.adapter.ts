import { Injectable } from '@nestjs/common';
import { MessageDedupPort } from '@/chat/application/port';

@Injectable()
export class InMemoryMessageDedupAdapter implements MessageDedupPort {
  private readonly reserved = new Set<string>();

  async reserve(messageId: string): Promise<boolean> {
    if (this.reserved.has(messageId)) {
      return false;
    }
    this.reserved.add(messageId);
    return true;
  }
}
