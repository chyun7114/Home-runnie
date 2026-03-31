import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { EventPublisherPort, MessageBusPort } from '@/chat/application/port';
import { ChatRepository } from '@/chat/repository';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { MetricsService } from '@/metrics/metrics.service';

type MockSocket = {
  id: string;
  emit: jest.Mock;
  disconnect: jest.Mock;
  handshake: { headers: Record<string, string> };
  data: Record<string, unknown>;
};

const createMockSocket = (id: string, cookieHeader?: string): MockSocket => ({
  id,
  emit: jest.fn(),
  disconnect: jest.fn(),
  handshake: { headers: cookieHeader ? { cookie: cookieHeader } : {} },
  data: {},
});

function createConfigService(options: {
  useExternalBrokers: 'true' | 'false';
  requireAuth?: 'true' | 'false';
}): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'CHAT_USE_EXTERNAL_BROKERS') return options.useExternalBrokers;
      if (key === 'CHAT_V2_REQUIRE_AUTH') return options.requireAuth ?? 'false';
      if (key === 'JWT_SECRET') return 'test-secret';
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

function createChatRepositoryMock(): ChatRepository {
  return {
    findMessagesAfterId: jest.fn().mockResolvedValue([]),
  } as unknown as ChatRepository;
}

describe('ChatV2GatewayAdapter', () => {
  it('외부 브로커 비활성화 시 not_ready를 전송하고 연결을 종료한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'false' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = createChatRepositoryMock();
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-1');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_not_ready', {
      message: 'v2 채팅 스켈레톤 단계입니다.',
    });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('외부 브로커 활성화 시 ready를 전송하고 연결을 유지한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = createChatRepositoryMock();
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-2');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_ready', {
      message: 'v2 채팅 실험 경로가 활성화되었습니다.',
    });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('v2_message 수신 시 브로커 발행 후 수신 확인 응답을 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = createChatRepositoryMock();
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-5');

    await gateway.handleV2Message({ roomId: '10', message: 'hello' }, socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_message_accepted', {
      roomId: '10',
      accepted: true,
      sequence: 1,
    });
  });

  it('같은 roomId 메시지는 sequence가 단조 증가한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = createChatRepositoryMock();
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-10');

    await gateway.handleV2Message({ roomId: '30', message: 'm1' }, socket as unknown as Socket);
    await gateway.handleV2Message({ roomId: '30', message: 'm2' }, socket as unknown as Socket);

    const calls = (messageBusPortMock.publish as jest.Mock).mock.calls.filter((call) =>
      String(call[0]).startsWith('chat.v2.room.30'),
    );
    expect(calls[0][1]).toEqual(expect.objectContaining({ sequence: 1 }));
    expect(calls[1][1]).toEqual(expect.objectContaining({ sequence: 2 }));
  });

  it('payload가 유효하지 않으면 invalid_payload로 거절한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = createChatRepositoryMock();
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-6');

    await gateway.handleV2Message({ roomId: 'x', message: '   ' }, socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_message_rejected', {
      roomId: 'x',
      accepted: false,
      reason: 'invalid_payload',
    });
  });

  it('v2_recover 요청 시 gap 메시지를 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = {
      findMessagesAfterId: jest.fn().mockResolvedValue([
        {
          id: 11,
          content: 'missed-1',
          senderId: 2,
          createdAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ]),
    } as unknown as ChatRepository;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-8');

    await gateway.handleV2Recover({ roomId: '10', lastMessageId: 10 }, socket as unknown as Socket);

    expect(chatRepository.findMessagesAfterId).toHaveBeenCalledWith(10, 10, 100);
    expect(socket.emit).toHaveBeenCalledWith('v2_gap_messages', {
      roomId: '10',
      fromMessageId: 10,
      messages: [
        {
          id: 11,
          message: 'missed-1',
          senderId: 2,
          createdAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ],
    });
  });

  it('v2_recover payload가 유효하지 않으면 실패를 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const chatRepository = createChatRepositoryMock();
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      chatRepository,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-9');

    await gateway.handleV2Recover({ roomId: 'x', lastMessageId: -1 }, socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_recover_failed', {
      roomId: 'x',
      reason: 'invalid_payload',
    });
  });
});
