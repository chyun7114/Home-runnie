import 'reflect-metadata';
import { ArgumentsHost, BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MESSAGE_MAPPING_METADATA, MESSAGE_METADATA } from '@nestjs/websockets/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatGateway } from '@/chat/chat.gateway';
import { ChatController } from '@/chat/controller';
import { CreateMessageDto } from '@/chat/dto/create-message.dto';
import { JoinRoomDto } from '@/chat/dto/room-join.dto';
import { CreateChatRoomRequestDto, GetChatRoomsRequestDto } from '@/chat/dto/request';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';

describe('v1 채팅 계약 테스트', () => {
  describe('HTTP 라우트 계약', () => {
    it('컨트롤러 기본 경로는 chat 이어야 한다', () => {
      const controllerPath = Reflect.getMetadata(PATH_METADATA, ChatController);
      expect(controllerPath).toBe('chat');
    });

    it('엔드포인트 메서드/경로 계약이 유지되어야 한다', () => {
      const routes: Array<{
        name: keyof ChatController;
        method: RequestMethod;
        path: string;
      }> = [
        { name: 'createChatRoom', method: RequestMethod.POST, path: 'rooms' },
        { name: 'getChatRoomByPostId', method: RequestMethod.GET, path: 'rooms/by-post/:postId' },
        { name: 'getMyChatRooms', method: RequestMethod.GET, path: 'rooms' },
        { name: 'getChatRoomMembers', method: RequestMethod.GET, path: 'rooms/:roomId/members' },
        {
          name: 'requestJoinChatRoom',
          method: RequestMethod.POST,
          path: 'rooms/:roomId/join-requests',
        },
        {
          name: 'getPendingJoinRequests',
          method: RequestMethod.GET,
          path: 'rooms/:roomId/join-requests',
        },
        {
          name: 'acceptJoinRequest',
          method: RequestMethod.PATCH,
          path: 'join-requests/:requestId/accept',
        },
        {
          name: 'rejectJoinRequest',
          method: RequestMethod.PATCH,
          path: 'join-requests/:requestId/reject',
        },
        {
          name: 'kickMember',
          method: RequestMethod.DELETE,
          path: 'rooms/:roomId/members/:memberId',
        },
        { name: 'deleteChatRoom', method: RequestMethod.DELETE, path: 'rooms/:roomId' },
      ];

      for (const route of routes) {
        const handler = ChatController.prototype[route.name] as (...args: unknown[]) => unknown;
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(route.method);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(route.path);
      }
    });
  });

  describe('WebSocket 이벤트 계약', () => {
    it('join_room 이벤트를 구독해야 한다', () => {
      const handler = ChatGateway.prototype.handleJoinRoom as (...args: unknown[]) => unknown;
      expect(Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)).toBe(true);
      expect(Reflect.getMetadata(MESSAGE_METADATA, handler)).toBe('join_room');
    });

    it('message 이벤트를 구독해야 한다', () => {
      const handler = ChatGateway.prototype.handleMessage as (...args: unknown[]) => unknown;
      expect(Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)).toBe(true);
      expect(Reflect.getMetadata(MESSAGE_METADATA, handler)).toBe('message');
    });
  });

  describe('DTO 유효성 계약', () => {
    it('채팅방 생성 요청은 정수 postId가 필요하다', async () => {
      const invalid = plainToInstance(CreateChatRoomRequestDto, { postId: 'abc' });
      const errors = await validate(invalid);
      expect(errors.some((error) => error.property === 'postId')).toBe(true);
    });

    it('채팅방 목록 조회는 기본 page=1, limit=20 이어야 한다', () => {
      const dto = plainToInstance(GetChatRoomsRequestDto, {});
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(20);
    });

    it('채팅방 목록 조회는 page/limit가 1 이상이어야 한다', async () => {
      const invalid = plainToInstance(GetChatRoomsRequestDto, { page: 0, limit: 0 });
      const errors = await validate(invalid);
      const fields = errors.map((error) => error.property);
      expect(fields).toContain('page');
      expect(fields).toContain('limit');
    });

    it('메시지 전송 payload는 message/roomId 문자열이 필요하다', async () => {
      const invalid = plainToInstance(CreateMessageDto, { message: '', roomId: '' });
      const errors = await validate(invalid);
      const fields = errors.map((error) => error.property);
      expect(fields).toContain('message');
      expect(fields).toContain('roomId');
    });

    it('방 입장 payload는 roomId 문자열이 필요하다', async () => {
      const invalid = plainToInstance(JoinRoomDto, { roomId: '' });
      const errors = await validate(invalid);
      expect(errors.some((error) => error.property === 'roomId')).toBe(true);
    });
  });

  describe('에러 응답 계약', () => {
    it('검증 실패 응답은 code/data 구조를 유지해야 한다', () => {
      const filter = new HttpExceptionFilter();
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const response = { status };
      const request = { url: '/chat/rooms?page=0' };

      const host = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost;

      filter.catch(
        new BadRequestException({
          message: ['page must not be less than 1'],
          error: 'Bad Request',
        }),
        host,
      );

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 400,
          data: expect.objectContaining({
            errorCode: 'Bad Request',
            message: expect.stringContaining('page'),
            path: '/chat/rooms?page=0',
            timestamp: expect.any(String),
          }),
        }),
      );
    });
  });
});
