import { Injectable } from '@nestjs/common';
import { ChatGateway } from '@/chat/chat.gateway';
import { RoomEventPort } from '@/chat/application/port';

@Injectable()
export class ChatGatewayRoomEventAdapter implements RoomEventPort {
  constructor(private readonly chatGateway: ChatGateway) {}

  emitToRoom(roomId: string, event: string, data: unknown): void {
    this.chatGateway.emitToRoom(roomId, event, data);
  }

  emitJoinRequestReceived(roomId: string, data: unknown): void {
    this.chatGateway.emitJoinRequestReceived(roomId, data);
  }

  emitMemberJoined(roomId: string, data: unknown): void {
    this.chatGateway.emitMemberJoined(roomId, data);
  }

  emitJoinRequestRejected(roomId: string, data: unknown): void {
    this.chatGateway.emitJoinRequestRejected(roomId, data);
  }

  emitMemberKicked(roomId: string, data: unknown): void {
    this.chatGateway.emitMemberKicked(roomId, data);
  }

  emitRoomDeleted(roomId: string): void {
    this.chatGateway.emitRoomDeleted(roomId);
  }
}
