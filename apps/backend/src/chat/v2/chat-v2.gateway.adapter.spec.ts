import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { EventPublisherPort, MessageBusPort } from '@/chat/application/port';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { MetricsService } from '@/metrics/metrics.service';

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

function createMetricsServiceMock(): MetricsService {
  return {
    incBrokerPublish: jest.fn(),
    incV2MessageResult: jest.fn(),
  } as unknown as MetricsService;
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
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      metricsServiceMock,
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
    expect((metricsServiceMock.incBrokerPublish as jest.Mock).mock.calls).toEqual([
      ['redis', 'ok', 'connection'],
      ['mq', 'ok', 'connection'],
    ]);
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
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-2');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_ready', {
      message: 'v2 채팅 실험 경로가 활성화되었습니다.',
    });
    expect((metricsServiceMock.incBrokerPublish as jest.Mock).mock.calls).toEqual([
      ['redis', 'ok', 'connection'],
      ['mq', 'ok', 'connection'],
    ]);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('v2_message 수신 시 브로커 발행 후 수신 확인 응답을 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService('true');
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      metricsServiceMock,
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
    expect((metricsServiceMock.incBrokerPublish as jest.Mock).mock.calls).toEqual([
      ['redis', 'ok', 'message'],
      ['mq', 'ok', 'message'],
    ]);
    expect(metricsServiceMock.incV2MessageResult).toHaveBeenCalledWith('accepted');
    expect(socket.emit).toHaveBeenCalledWith('v2_message_accepted', {
      roomId: '10',
      accepted: true,
    });
  });

  it('v2_message 발행 실패 시 거절 응답을 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService('true');
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-4');

    await gateway.handleV2Message(
      { roomId: '20', message: 'fail-case' },
      socket as unknown as Socket,
    );

    expect(eventPublisherPortMock.publish).not.toHaveBeenCalled();
    expect((metricsServiceMock.incBrokerPublish as jest.Mock).mock.calls).toEqual([
      ['redis', 'fail', 'message'],
    ]);
    expect(metricsServiceMock.incV2MessageResult).toHaveBeenCalledWith(
      'rejected',
      'broker_unavailable',
    );
    expect(socket.emit).toHaveBeenCalledWith('v2_message_rejected', {
      roomId: '20',
      accepted: false,
      reason: 'broker_unavailable',
    });
  });

  it('Redis 성공 후 MQ 실패 시에도 거절 응답을 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockRejectedValue(new Error('mq down')),
    };
    const configService = createConfigService('true');
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-5');

    await gateway.handleV2Message(
      { roomId: '30', message: 'mq-fail-case' },
      socket as unknown as Socket,
    );

    expect(messageBusPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.room.30',
      expect.objectContaining({
        roomId: '30',
        message: 'mq-fail-case',
        socketId: 'socket-5',
      }),
    );
    expect(eventPublisherPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.message.received',
      expect.objectContaining({
        roomId: '30',
        message: 'mq-fail-case',
        socketId: 'socket-5',
      }),
    );
    expect((metricsServiceMock.incBrokerPublish as jest.Mock).mock.calls).toEqual([
      ['redis', 'ok', 'message'],
      ['mq', 'fail', 'message'],
    ]);
    expect(metricsServiceMock.incV2MessageResult).toHaveBeenCalledWith(
      'rejected',
      'broker_unavailable',
    );
    expect(socket.emit).toHaveBeenCalledWith('v2_message_rejected', {
      roomId: '30',
      accepted: false,
      reason: 'broker_unavailable',
    });
  });
});
