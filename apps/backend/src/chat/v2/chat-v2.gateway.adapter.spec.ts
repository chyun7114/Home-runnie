import { ConfigService } from '@nestjs/config';
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

function createConfigService(useExternalBrokers: 'true' | 'false'): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'CHAT_USE_EXTERNAL_BROKERS') {
        return useExternalBrokers;
      }
      return defaultValue ?? '';
    }),
  } as unknown as ConfigService;
}

describe('ChatV2GatewayAdapter', () => {
  it('외부 브로커 비활성화 시 not_ready를 전송하고 연결을 종료한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService('false');
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
    );
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

  it('외부 브로커 활성화 시 ready를 전송하고 연결을 유지한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService('true');
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
    );
    const socket = createMockSocket('socket-2');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_ready', {
      message: 'v2 채팅 실험 경로가 활성화되었습니다.',
    });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('v2_message 수신 시 브로커 발행 후 수신 확인 응답을 보낸다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService('true');
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
    );
    const socket = createMockSocket('socket-3');

    await gateway.handleV2Message({ roomId: '10', message: 'hello' }, socket as unknown as Socket);

    expect(messageBusPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.room.10',
      expect.objectContaining({
        roomId: '10',
        message: 'hello',
        socketId: 'socket-3',
      }),
    );
    expect(eventPublisherPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.message.received',
      expect.objectContaining({
        roomId: '10',
        message: 'hello',
        socketId: 'socket-3',
      }),
    );
    expect((messageBusPortMock.publish as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (eventPublisherPortMock.publish as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(socket.emit).toHaveBeenCalledWith('v2_message_accepted', {
      roomId: '10',
      accepted: true,
    });
  });

  it('v2_message 발행 실패 시 거절 응답을 보낸다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService('true');
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
    );
    const socket = createMockSocket('socket-4');

    await gateway.handleV2Message(
      { roomId: '20', message: 'fail-case' },
      socket as unknown as Socket,
    );

    expect(eventPublisherPortMock.publish).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('v2_message_rejected', {
      roomId: '20',
      accepted: false,
      reason: 'broker_unavailable',
    });
  });
});
