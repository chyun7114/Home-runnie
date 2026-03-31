import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { ChatController } from '@/chat/controller';
import { ChatGateway } from '@/chat/chat.gateway';
import { CHAT_ROUTES, CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';

describe('채팅 버저닝 가드레일', () => {
  it('v1 HTTP 컨트롤러 기본 경로를 고정한다', () => {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, ChatController);

    expect(controllerPath).toBe(CHAT_ROUTES.V1_HTTP_BASE_PATH);
    expect(controllerPath).toBe('chat');
  });

  it('v1 웹소켓 네임스페이스를 고정한다', () => {
    const gatewayOptions = Reflect.getMetadata(GATEWAY_OPTIONS, ChatGateway) as {
      namespace?: string;
    };

    expect(gatewayOptions.namespace).toBe(CHAT_WS_NAMESPACES.V1);
    expect(gatewayOptions.namespace).toBe('chat');
  });

  it('향후 스케일아웃 경로를 위한 v2 경계를 예약한다', () => {
    expect(CHAT_ROUTES.V2_HTTP_BASE_PATH).toBe('api/v2/chat');
    expect(CHAT_WS_NAMESPACES.V2).toBe('ws-v2');
  });
});
