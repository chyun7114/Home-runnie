import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChatService } from '@/chat/service';
import { CurrentMember } from '@/common';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CHAT_ROUTES } from '@/common/versioning/api-version.constants';
import { CreateChatRoomRequestDto, GetChatRoomsRequestDto } from '@/chat/dto/request';
import {
  ChatRoomResponseDto,
  GetChatRoomsResponseDto,
  ChatRoomMemberResponseDto,
  JoinRequestResponseDto,
} from '@/chat/dto/response';
import { CreateChatRoomSwagger, GetChatRoomsSwagger } from '@/chat/swagger';

@ApiTags('채팅방')
@Controller(CHAT_ROUTES.V1_HTTP_BASE_PATH)
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('rooms')
  @CreateChatRoomSwagger
  async createChatRoom(
    @CurrentMember() memberId: number,
    @Body() createChatRoomDto: CreateChatRoomRequestDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatService.createChatRoom(createChatRoomDto.postId, memberId);
  }

  @Get('rooms/by-post/:postId')
  async getChatRoomByPostId(@Param('postId', ParseIntPipe) postId: number) {
    const chatRoom = await this.chatService.getChatRoomByPostId(postId);
    return { chatRoomId: chatRoom?.id ?? null };
  }

  @Get('rooms')
  @GetChatRoomsSwagger
  async getMyChatRooms(
    @CurrentMember() memberId: number,
    @Query() query: GetChatRoomsRequestDto,
  ): Promise<GetChatRoomsResponseDto> {
    return this.chatService.getMyChatRooms(memberId, query.page, query.limit);
  }

  @Get('rooms/:roomId/members')
  async getChatRoomMembers(
    @CurrentMember() memberId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ): Promise<ChatRoomMemberResponseDto[]> {
    return this.chatService.getChatRoomMembers(roomId, memberId);
  }

  @Post('rooms/:roomId/join-requests')
  async requestJoinChatRoom(
    @CurrentMember() memberId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.chatService.requestJoinChatRoom(roomId, memberId);
  }

  @Get('rooms/:roomId/join-requests')
  async getPendingJoinRequests(
    @CurrentMember() memberId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ): Promise<JoinRequestResponseDto[]> {
    return this.chatService.getPendingJoinRequests(roomId, memberId);
  }

  @Patch('join-requests/:requestId/accept')
  async acceptJoinRequest(
    @CurrentMember() memberId: number,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    return this.chatService.acceptJoinRequest(requestId, memberId);
  }

  @Patch('join-requests/:requestId/reject')
  async rejectJoinRequest(
    @CurrentMember() memberId: number,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    return this.chatService.rejectJoinRequest(requestId, memberId);
  }

  @Delete('rooms/:roomId/members/:memberId')
  async kickMember(
    @CurrentMember() hostId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    return this.chatService.kickMember(roomId, memberId, hostId);
  }

  @Delete('rooms/:roomId')
  async deleteChatRoom(
    @CurrentMember() hostId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.chatService.deleteChatRoom(roomId, hostId);
  }
}
