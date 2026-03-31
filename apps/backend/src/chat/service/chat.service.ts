import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ChatRepository } from '@/chat/repository';
import { ROOM_EVENT_PORT, RoomEventPort } from '@/chat/application/port';
import {
  ChatRoomResponseDto,
  GetChatRoomsResponseDto,
  ChatRoomMemberResponseDto,
  JoinRequestResponseDto,
} from '@/chat/dto/response';
import { ChatRoomMemberRole, ChatJoinRequestStatus } from '@homerunnie/shared';
import { DATABASE_CONNECTION } from '@/common';
import { PostStatusEnum } from '@/common/enums/post-status.enum';
import * as schema from '@/common/db/schema';

type DbType = NodePgDatabase<typeof schema>;

@Injectable()
export class ChatService {
  constructor(
    @Inject() private readonly chatRepository: ChatRepository,
    @Inject(DATABASE_CONNECTION) private readonly db: DbType,
    @Inject(ROOM_EVENT_PORT) private readonly roomEventPort: RoomEventPort,
  ) {}

  async createChatRoom(postId: number, memberId: number): Promise<ChatRoomResponseDto> {
    const chatRoom = await this.db.transaction(async (tx) => {
      const newChatRoom = await this.chatRepository.createChatRoom(postId, tx);

      await this.chatRepository.createChatRoomMember(
        newChatRoom.id,
        memberId,
        ChatRoomMemberRole.HOST,
        tx,
      );

      return newChatRoom;
    });

    return ChatRoomResponseDto.from({
      ...chatRoom,
      role: ChatRoomMemberRole.HOST,
    });
  }

  async getChatRoomByPostId(postId: number) {
    return this.chatRepository.findChatRoomByPostId(postId);
  }

  async getMyChatRooms(
    memberId: number,
    page: number = 1,
    limit: number = 20,
  ): Promise<GetChatRoomsResponseDto> {
    const [chatRooms, total] = await Promise.all([
      this.chatRepository.findChatRoomsByMemberId(memberId, page, limit),
      this.chatRepository.countChatRoomsByMemberId(memberId),
    ]);

    return GetChatRoomsResponseDto.from(chatRooms, total, page, limit);
  }

  async getChatRoomMembers(
    chatRoomId: number,
    requesterId: number,
  ): Promise<ChatRoomMemberResponseDto[]> {
    const requester = await this.chatRepository.findChatRoomMember(chatRoomId, requesterId);
    if (!requester) {
      throw new ForbiddenException('채팅방 멤버만 조회할 수 있습니다.');
    }

    const members = await this.chatRepository.findChatRoomMembersByRoomId(chatRoomId);
    return members.map((m) => ChatRoomMemberResponseDto.from(m));
  }

  async requestJoinChatRoom(chatRoomId: number, memberId: number) {
    const [chatRoom, existingMember, existingRequest, postStatus, gameDate] = await Promise.all([
      this.chatRepository.findChatRoomById(chatRoomId),
      this.chatRepository.findChatRoomMember(chatRoomId, memberId),
      this.chatRepository.findExistingJoinRequest(chatRoomId, memberId),
      this.chatRepository.findPostStatusByChatRoomId(chatRoomId),
      this.chatRepository.findGameDateByChatRoomId(chatRoomId),
    ]);

    if (!chatRoom) {
      throw new NotFoundException('채팅방을 찾을 수 없습니다.');
    }
    if (postStatus !== PostStatusEnum.ACTIVE) {
      throw new BadRequestException('마감된 모집글에는 참여 요청을 할 수 없습니다.');
    }
    if (gameDate && new Date(gameDate) < new Date()) {
      throw new BadRequestException('경기 날짜가 지난 모집글에는 참여 요청을 할 수 없습니다.');
    }
    if (existingMember) {
      throw new ConflictException('이미 채팅방에 참여 중입니다.');
    }

    if (existingRequest) {
      if (existingRequest.status === ChatJoinRequestStatus.PENDING) {
        throw new ConflictException('이미 참여 요청이 존재합니다.');
      }

      const request = await this.chatRepository.resetJoinRequestToPending(chatRoomId, memberId);

      this.roomEventPort.emitJoinRequestReceived(String(chatRoomId), {
        requestId: request.id,
        memberId,
        chatRoomId,
      });

      return request;
    }

    const request = await this.chatRepository.createJoinRequest(chatRoomId, memberId);

    this.roomEventPort.emitJoinRequestReceived(String(chatRoomId), {
      requestId: request.id,
      memberId,
      chatRoomId,
    });

    return request;
  }

  async getPendingJoinRequests(
    chatRoomId: number,
    hostId: number,
  ): Promise<JoinRequestResponseDto[]> {
    await this.verifyHost(chatRoomId, hostId);

    const requests = await this.chatRepository.findPendingJoinRequests(chatRoomId);
    return requests.map((r) => JoinRequestResponseDto.from(r));
  }

  async acceptJoinRequest(requestId: number, hostId: number) {
    const request = await this.chatRepository.findJoinRequestById(requestId);
    if (!request) {
      throw new NotFoundException('참여 요청을 찾을 수 없습니다.');
    }

    if (request.status !== ChatJoinRequestStatus.PENDING) {
      throw new BadRequestException('이미 처리된 요청입니다.');
    }

    await this.verifyHost(request.chatRoomId, hostId);

    await this.db.transaction(async (tx) => {
      const updated = await this.chatRepository.updateJoinRequestStatus(
        requestId,
        ChatJoinRequestStatus.ACCEPTED,
        tx,
      );
      if (!updated) {
        throw new BadRequestException('이미 처리된 요청입니다.');
      }

      const existingMember = await this.chatRepository.findChatRoomMember(
        request.chatRoomId,
        request.memberId,
        tx,
      );
      if (existingMember) {
        throw new ConflictException('이미 채팅방에 참여 중인 멤버입니다.');
      }

      await this.chatRepository.createChatRoomMember(
        request.chatRoomId,
        request.memberId,
        ChatRoomMemberRole.MEMBER,
        tx,
      );
    });

    // 시스템 메시지를 DB에 저장하고 브로드캐스트
    const systemMessage = '[SYSTEM]새로운 멤버가 참여했습니다.';
    await this.chatRepository.saveMessage(request.chatRoomId, request.memberId, systemMessage);

    this.roomEventPort.emitMemberJoined(String(request.chatRoomId), {
      memberId: request.memberId,
    });

    this.roomEventPort.emitToRoom(String(request.chatRoomId), 'received_message', {
      nickname: '',
      message: systemMessage,
      isOwn: false,
      roomId: String(request.chatRoomId),
    });

    return { chatRoomId: request.chatRoomId, memberId: request.memberId };
  }

  async rejectJoinRequest(requestId: number, hostId: number) {
    const request = await this.chatRepository.findJoinRequestById(requestId);
    if (!request) {
      throw new NotFoundException('참여 요청을 찾을 수 없습니다.');
    }

    if (request.status !== ChatJoinRequestStatus.PENDING) {
      throw new BadRequestException('이미 처리된 요청입니다.');
    }

    await this.verifyHost(request.chatRoomId, hostId);

    const updated = await this.chatRepository.updateJoinRequestStatus(
      requestId,
      ChatJoinRequestStatus.REJECTED,
    );
    if (!updated) {
      throw new BadRequestException('이미 처리된 요청입니다.');
    }

    this.roomEventPort.emitJoinRequestRejected(String(request.chatRoomId), {
      memberId: request.memberId,
    });

    return { chatRoomId: request.chatRoomId, memberId: request.memberId };
  }

  async kickMember(chatRoomId: number, targetMemberId: number, hostId: number) {
    await this.verifyHost(chatRoomId, hostId);

    if (targetMemberId === hostId) {
      throw new BadRequestException('자기 자신을 강퇴할 수 없습니다.');
    }

    const target = await this.chatRepository.findChatRoomMember(chatRoomId, targetMemberId);
    if (!target) {
      throw new NotFoundException('해당 멤버를 찾을 수 없습니다.');
    }

    await this.chatRepository.softDeleteChatRoomMember(chatRoomId, targetMemberId);

    this.roomEventPort.emitMemberKicked(String(chatRoomId), {
      memberId: targetMemberId,
    });

    return { chatRoomId, memberId: targetMemberId };
  }

  async deleteChatRoom(chatRoomId: number, hostId: number) {
    await this.verifyHost(chatRoomId, hostId);

    this.roomEventPort.emitRoomDeleted(String(chatRoomId));

    await this.chatRepository.softDeleteChatRoom(chatRoomId);
    return { chatRoomId };
  }

  private async verifyHost(chatRoomId: number, memberId: number) {
    const member = await this.chatRepository.findChatRoomMember(chatRoomId, memberId);
    if (!member) {
      throw new ForbiddenException('채팅방 멤버가 아닙니다.');
    }
    if (member.role !== ChatRoomMemberRole.HOST) {
      throw new ForbiddenException('방장만 수행할 수 있는 작업입니다.');
    }
    return member;
  }
}
