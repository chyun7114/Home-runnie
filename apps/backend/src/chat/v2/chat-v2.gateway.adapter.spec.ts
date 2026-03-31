import { Socket } from 'socket.io';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { EventPublisherPort, MessageBusPort } from '@/chat/application/port';

type MockSocket = {
  id: string;
  emit: jest.Mock;
  disconnect: jest.Mock;
};

const createMockSocket = (id: string): MockSocket => ({
  id,
  emit: jest.fn(),
  disconnect: jest.fn(),
});

describe('ChatV2GatewayAdapter', () => {
  it('연결 수신 시 버스/이벤트 포트로 기록을 남기고 연결을 종료한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new ChatV2GatewayAdapter(messageBusPortMock, eventPublisherPortMock);
    const socket = createMockSocket('socket-1');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(messageBusPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.connection',
      expect.objectContaining({ socketId: 'socket-1' }),
    );
    expect(eventPublisherPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.connection.received',
      expect.objectContaining({ socketId: 'socket-1' }),
    );
    expect(socket.emit).toHaveBeenCalledWith('v2_not_ready', {
      message: 'v2 채팅 스켈레톤 단계입니다.',
    });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
