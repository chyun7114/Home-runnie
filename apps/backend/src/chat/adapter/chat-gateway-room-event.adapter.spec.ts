import { ChatGatewayRoomEventAdapter } from '@/chat/adapter/chat-gateway-room-event.adapter';
import { ChatGateway } from '@/chat/chat.gateway';

describe('ChatGatewayRoomEventAdapter', () => {
  const gatewayMock = {
    emitToRoom: jest.fn(),
    emitJoinRequestReceived: jest.fn(),
    emitMemberJoined: jest.fn(),
    emitJoinRequestRejected: jest.fn(),
    emitMemberKicked: jest.fn(),
    emitRoomDeleted: jest.fn(),
  } as unknown as ChatGateway;

  const adapter = new ChatGatewayRoomEventAdapter(gatewayMock);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emitToRoom을 게이트웨이에 위임한다', () => {
    adapter.emitToRoom('1', 'received_message', { ok: true });
    expect(gatewayMock.emitToRoom).toHaveBeenCalledWith('1', 'received_message', { ok: true });
  });

  it('emitJoinRequestReceived를 게이트웨이에 위임한다', () => {
    adapter.emitJoinRequestReceived('1', { requestId: 1 });
    expect(gatewayMock.emitJoinRequestReceived).toHaveBeenCalledWith('1', { requestId: 1 });
  });

  it('emitMemberJoined를 게이트웨이에 위임한다', () => {
    adapter.emitMemberJoined('1', { memberId: 10 });
    expect(gatewayMock.emitMemberJoined).toHaveBeenCalledWith('1', { memberId: 10 });
  });

  it('emitJoinRequestRejected를 게이트웨이에 위임한다', () => {
    adapter.emitJoinRequestRejected('1', { memberId: 10 });
    expect(gatewayMock.emitJoinRequestRejected).toHaveBeenCalledWith('1', { memberId: 10 });
  });

  it('emitMemberKicked를 게이트웨이에 위임한다', () => {
    adapter.emitMemberKicked('1', { memberId: 10 });
    expect(gatewayMock.emitMemberKicked).toHaveBeenCalledWith('1', { memberId: 10 });
  });

  it('emitRoomDeleted를 게이트웨이에 위임한다', () => {
    adapter.emitRoomDeleted('1');
    expect(gatewayMock.emitRoomDeleted).toHaveBeenCalledWith('1');
  });
});
