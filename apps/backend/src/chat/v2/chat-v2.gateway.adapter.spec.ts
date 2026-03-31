import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { EventPublisherPort, MessageBusPort } from '@/chat/application/port';
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
      if (key === 'CHAT_USE_EXTERNAL_BROKERS') {
        return options.useExternalBrokers;
      }
      if (key === 'CHAT_V2_REQUIRE_AUTH') {
        return options.requireAuth ?? 'false';
      }
      if (key === 'JWT_SECRET') {
        return 'test-secret';
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
    const configService = createConfigService({ useExternalBrokers: 'false' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
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
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
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

  it('인증 필수 모드에서 토큰이 없으면 not_authorized 후 연결 종료한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true', requireAuth: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-3');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_not_authorized', {
      message: '인증이 필요합니다.',
    });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(messageBusPortMock.publish).not.toHaveBeenCalled();
  });

  it('인증 필수 모드에서 유효한 토큰이면 연결을 허용한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true', requireAuth: 'true' });
    const jwtService = {
      verifyAsync: jest.fn().mockResolvedValue({ memberId: 7 }),
    } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-4', 'accessToken=valid-token');

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.data.v2MemberId).toBe(7);
    expect(socket.emit).toHaveBeenCalledWith('v2_ready', {
      message: 'v2 채팅 실험 경로가 활성화되었습니다.',
    });
  });

  it('v2_message 수신 시 브로커 발행 후 수신 확인 응답을 반환한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-5');

    await gateway.handleV2Message({ roomId: '10', message: 'hello' }, socket as unknown as Socket);

    expect(messageBusPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.room.10',
      expect.objectContaining({ roomId: '10', message: 'hello', socketId: 'socket-5' }),
    );
    expect(eventPublisherPortMock.publish).toHaveBeenCalledWith(
      'chat.v2.message.received',
      expect.objectContaining({ roomId: '10', message: 'hello', socketId: 'socket-5' }),
    );
    expect(socket.emit).toHaveBeenCalledWith('v2_message_accepted', {
      roomId: '10',
      accepted: true,
    });
  });

  it('payload가 유효하지 않으면 invalid_payload로 거절한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
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
    expect(messageBusPortMock.publish).not.toHaveBeenCalled();
  });

  it('인증 필수 모드에서 권한 정보가 없으면 unauthorized로 거절한다', async () => {
    const messageBusPortMock: MessageBusPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const eventPublisherPortMock: EventPublisherPort = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const configService = createConfigService({ useExternalBrokers: 'true', requireAuth: 'true' });
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const metricsServiceMock = createMetricsServiceMock();
    const gateway = new ChatV2GatewayAdapter(
      messageBusPortMock,
      eventPublisherPortMock,
      configService,
      jwtService,
      metricsServiceMock,
    );
    const socket = createMockSocket('socket-7');

    await gateway.handleV2Message({ roomId: '10', message: 'hello' }, socket as unknown as Socket);

    expect(socket.emit).toHaveBeenCalledWith('v2_message_rejected', {
      roomId: '10',
      accepted: false,
      reason: 'unauthorized',
    });
    expect(messageBusPortMock.publish).not.toHaveBeenCalled();
  });
});
