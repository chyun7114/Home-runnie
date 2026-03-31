import { ChatRepository } from '@/chat/repository';
import { MessageDedupPort } from '@/chat/application/port';
import { ChatV2MessagePersistenceService } from '@/chat/v2/chat-v2-message-persistence.service';

describe('ChatV2MessagePersistenceService', () => {
  const createService = () => {
    const chatRepositoryMock = {
      findAnyMemberIdByChatRoom: jest.fn(),
      saveMessage: jest.fn(),
      updateChatRoomUpdatedAt: jest.fn(),
    } as unknown as ChatRepository;
    const dedupPortMock = {
      reserve: jest.fn(),
    } as MessageDedupPort;

    const service = new ChatV2MessagePersistenceService(chatRepositoryMock, dedupPortMock);
    return { service, chatRepositoryMock, dedupPortMock };
  };

  it('새 메시지는 저장하고 saved를 반환한다', async () => {
    const { service, chatRepositoryMock, dedupPortMock } = createService();
    (dedupPortMock.reserve as jest.Mock).mockResolvedValue(true);

    const result = await service.persist({
      messageId: 'm-1',
      roomId: '10',
      message: 'hello',
      senderId: 99,
      socketId: 'socket-1',
      receivedAt: new Date().toISOString(),
    });

    expect(result).toBe('saved');
    expect(chatRepositoryMock.saveMessage).toHaveBeenCalledWith(10, 99, 'hello');
    expect(chatRepositoryMock.updateChatRoomUpdatedAt).toHaveBeenCalledWith(10);
  });

  it('중복 메시지는 저장하지 않고 duplicate를 반환한다', async () => {
    const { service, chatRepositoryMock, dedupPortMock } = createService();
    (dedupPortMock.reserve as jest.Mock).mockResolvedValue(false);

    const result = await service.persist({
      messageId: 'dup-1',
      roomId: '10',
      message: 'hello',
      senderId: 99,
      socketId: 'socket-1',
      receivedAt: new Date().toISOString(),
    });

    expect(result).toBe('duplicate');
    expect(chatRepositoryMock.saveMessage).not.toHaveBeenCalled();
    expect(chatRepositoryMock.updateChatRoomUpdatedAt).not.toHaveBeenCalled();
  });

  it('senderId가 없으면 채팅방 멤버를 조회해 저장한다', async () => {
    const { service, chatRepositoryMock, dedupPortMock } = createService();
    (dedupPortMock.reserve as jest.Mock).mockResolvedValue(true);
    (chatRepositoryMock.findAnyMemberIdByChatRoom as jest.Mock).mockResolvedValue(15);

    const result = await service.persist({
      messageId: 'm-2',
      roomId: '20',
      message: 'fallback sender',
      socketId: 'socket-2',
      receivedAt: new Date().toISOString(),
    });

    expect(result).toBe('saved');
    expect(chatRepositoryMock.findAnyMemberIdByChatRoom).toHaveBeenCalledWith(20);
    expect(chatRepositoryMock.saveMessage).toHaveBeenCalledWith(20, 15, 'fallback sender');
  });

  it('유효하지 않은 payload면 예외를 던진다', async () => {
    const { service } = createService();

    await expect(
      service.persist({
        messageId: '',
        roomId: '10',
        message: 'hello',
        socketId: 'socket-3',
        receivedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('messageId is required');
  });
});
