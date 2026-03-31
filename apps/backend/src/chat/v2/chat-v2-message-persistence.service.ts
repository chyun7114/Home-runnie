import { Inject, Injectable } from '@nestjs/common';
import { ChatRepository } from '@/chat/repository';
import { MESSAGE_DEDUP_PORT, MessageDedupPort } from '@/chat/application/port';
import { ChatV2MessageReceivedEvent } from '@/chat/v2/chat-v2-message-event';

type PersistResult = 'saved' | 'duplicate';

@Injectable()
export class ChatV2MessagePersistenceService {
  constructor(
    private readonly chatRepository: ChatRepository,
    @Inject(MESSAGE_DEDUP_PORT) private readonly messageDedupPort: MessageDedupPort,
  ) {}

  async persist(payload: ChatV2MessageReceivedEvent): Promise<PersistResult> {
    this.validatePayload(payload);

    const reserved = await this.messageDedupPort.reserve(payload.messageId);
    if (!reserved) {
      return 'duplicate';
    }

    const chatRoomId = Number(payload.roomId);
    const senderId =
      payload.senderId && payload.senderId > 0
        ? payload.senderId
        : await this.chatRepository.findAnyMemberIdByChatRoom(chatRoomId);

    if (!senderId) {
      throw new Error('chat room member not found');
    }

    await this.chatRepository.saveMessage(chatRoomId, senderId, payload.message);
    await this.chatRepository.updateChatRoomUpdatedAt(chatRoomId);
    return 'saved';
  }

  private validatePayload(payload: ChatV2MessageReceivedEvent) {
    if (!payload.messageId || payload.messageId.trim().length === 0) {
      throw new Error('messageId is required');
    }
    if (!payload.roomId || Number.isNaN(Number(payload.roomId))) {
      throw new Error('roomId is invalid');
    }
    if (!payload.message || payload.message.trim().length === 0) {
      throw new Error('message is required');
    }
  }
}
