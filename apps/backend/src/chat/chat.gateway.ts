import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JoinRoomDto } from '@/chat/dto/room-join.dto';
import { CreateMessageDto } from '@/chat/dto/create-message.dto';
import { Injectable, Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MemberRepository } from '@/member/repository';
import { ChatRepository } from '@/chat/repository';
import { JwtPayload } from '@/auth/types';
import { WsJwtGuard, WsSocketUser, WsUser, extractTokenFromSocket } from '@/chat/ws-jwt.guard';
import { MetricsService } from '@/metrics';
import { CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';

@Injectable()
@WebSocketGateway({
  namespace: CHAT_WS_NAMESPACES.V1,
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,https://www.homerunnie.app').split(
      ',',
    ),
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly memberRepository: MemberRepository,
    private readonly chatRepository: ChatRepository,
    private readonly metricsService: MetricsService,
  ) {}

  async handleConnection(socket: Socket) {
    const handshakeStartedAt = Date.now();
    this.metricsService.onSocketConnected(socket.id);

    try {
      const token = extractTokenFromSocket(socket);
      if (!token) {
        this.logger.warn(`missing accessToken cookie (${socket.id})`);
        this.metricsService.incFailure('auth_invalid_token');
        this.metricsService.observeHandshake(Date.now() - handshakeStartedAt, 'fail');
        socket.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const result = await this.metricsService.measureDbQuery('member_find_with_profile', () =>
        this.memberRepository.findMemberWithProfile(payload.memberId),
      );
      const profile = result[0]?.profile;

      if (!profile) {
        this.logger.warn(`profile not found for member ${payload.memberId} (${socket.id})`);
        this.metricsService.incFailure('auth_profile_lookup_fail');
        this.metricsService.observeHandshake(Date.now() - handshakeStartedAt, 'fail');
        socket.disconnect();
        return;
      }

      socket.data.user = {
        memberId: payload.memberId,
        nickname: profile.nickname,
        supportTeam: profile.supportTeam,
        roomIds: new Set<string>(),
      } satisfies WsSocketUser;

      socket.emit('authenticated');
      this.metricsService.observeHandshake(Date.now() - handshakeStartedAt, 'ok');
      this.logger.log(`client connected: ${profile.nickname} (${socket.id})`);
    } catch (error) {
      this.logger.warn(
        `ws auth failed (${socket.id}): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      this.metricsService.incFailure('auth_invalid_token');
      this.metricsService.observeHandshake(Date.now() - handshakeStartedAt, 'fail');
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket) {
    if (socket.data?.pendingMessage === true) {
      this.metricsService.incFailure('socket_disconnected_before_ack');
    }
    this.metricsService.onSocketDisconnected(socket.id);
    this.updateActiveRoomGauge();
    this.logger.log(`client disconnected: ${socket.id}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @WsUser() user: WsSocketUser,
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() socket: Socket,
  ) {
    const joinStartedAt = Date.now();
    const { roomId } = data;
    const { nickname } = user;
    const chatRoomId = parseInt(roomId, 10);

    if (Number.isNaN(chatRoomId)) {
      this.metricsService.incFailure('join_permission_fail');
      this.metricsService.observeJoin(Date.now() - joinStartedAt, 'fail');
      return;
    }

    const chatRoom = await this.metricsService.measureDbQuery('chat_room_by_id', () =>
      this.chatRepository.findChatRoomById(chatRoomId),
    );
    if (!chatRoom) {
      this.metricsService.incFailure('join_room_not_found');
      this.metricsService.observeJoin(Date.now() - joinStartedAt, 'fail');
      return;
    }

    socket.join(roomId);
    user.roomIds.add(roomId);
    this.updateActiveRoomGauge();

    await this.metricsService.measureDbQuery('chat_update_last_read_at', () =>
      this.chatRepository.updateLastReadAt(chatRoomId, user.memberId),
    );

    const history = await this.metricsService.measureDbQuery('chat_find_messages_by_room', () =>
      this.chatRepository.findMessagesByRoomId(chatRoomId),
    );

    socket.emit(
      'message_history',
      history.map((msg) => ({
        id: msg.id,
        message: msg.content,
        isOwn: msg.senderId === user.memberId,
        nickname: msg.nickname,
        supportTeam: msg.supportTeam,
        createdAt: msg.createdAt,
      })),
    );

    this.metricsService.observeJoin(Date.now() - joinStartedAt, 'ok');
    this.logger.log(`${nickname} joined room ${roomId}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message')
  async handleMessage(
    @WsUser() user: WsSocketUser,
    @MessageBody() data: CreateMessageDto,
    @ConnectedSocket() socket: Socket,
  ) {
    const messageStartedAt = Date.now();
    const { message, roomId } = data;

    socket.data.pendingMessage = true;
    this.metricsService.incPendingMessage();

    if (!user.roomIds.has(roomId)) {
      this.metricsService.incFailure('join_permission_fail');
      this.metricsService.observeMessage(Date.now() - messageStartedAt, 'fail');
      socket.data.pendingMessage = false;
      this.metricsService.decPendingMessage();
      return;
    }

    const { nickname, memberId, supportTeam } = user;
    const chatRoomId = parseInt(roomId, 10);

    try {
      if (Number.isNaN(chatRoomId)) {
        this.metricsService.incFailure('join_permission_fail');
        this.metricsService.observeMessage(Date.now() - messageStartedAt, 'fail');
        return;
      }

      await Promise.all([
        this.metricsService.measureDbQuery('chat_save_message', () =>
          this.chatRepository.saveMessage(chatRoomId, memberId, message),
        ),
        this.metricsService.measureDbQuery('chat_update_room_updated_at', () =>
          this.chatRepository.updateChatRoomUpdatedAt(chatRoomId),
        ),
      ]);

      socket
        .to(roomId)
        .emit('received_message', { nickname, message, isOwn: false, roomId, supportTeam });
      socket.emit('received_message', { nickname, message, isOwn: true, roomId, supportTeam });

      this.metricsService.observeMessage(Date.now() - messageStartedAt, 'ok');
    } catch (error) {
      this.metricsService.incFailure('message_timeout');
      this.metricsService.observeMessage(Date.now() - messageStartedAt, 'fail');
      throw error;
    } finally {
      socket.data.pendingMessage = false;
      this.metricsService.decPendingMessage();
    }
  }

  emitToRoom(roomId: string, event: string, data: unknown) {
    this.server.to(roomId).emit(event, data);
  }

  emitJoinRequestReceived(roomId: string, data: unknown) {
    this.server.to(roomId).emit('join_request_received', data);
  }

  emitMemberJoined(roomId: string, data: unknown) {
    this.server.to(roomId).emit('member_joined', data);
  }

  emitJoinRequestRejected(roomId: string, data: unknown) {
    this.server.to(roomId).emit('join_request_rejected', data);
  }

  emitMemberKicked(roomId: string, data: unknown) {
    this.server.to(roomId).emit('member_kicked', data);
  }

  emitRoomDeleted(roomId: string) {
    this.server.to(roomId).emit('room_deleted', { roomId });
  }

  private updateActiveRoomGauge() {
    if (!this.server?.sockets?.adapter || !this.server?.sockets?.sockets) return;

    const rooms = this.server.sockets.adapter.rooms;
    const sockets = this.server.sockets.sockets;
    let activeRooms = 0;

    for (const roomId of rooms.keys()) {
      if (!sockets.has(roomId)) activeRooms += 1;
    }

    this.metricsService.setActiveRoomCount(activeRooms);
  }
}
