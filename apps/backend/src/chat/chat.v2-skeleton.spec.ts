import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { ChatV2Controller } from '@/chat/v2/chat-v2.controller';
import { ChatV2GatewayAdapter } from '@/chat/v2/chat-v2.gateway.adapter';
import { CHAT_ROUTES, CHAT_WS_NAMESPACES } from '@/common/versioning/api-version.constants';

describe('v2 경계 스켈레톤', () => {
  it('v2 HTTP 컨트롤러 기본 경로를 고정한다', () => {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, ChatV2Controller);

    expect(controllerPath).toBe(CHAT_ROUTES.V2_HTTP_BASE_PATH);
    expect(controllerPath).toBe('api/v2/chat');
  });

  it('v2 웹소켓 네임스페이스를 고정한다', () => {
    const gatewayOptions = Reflect.getMetadata(GATEWAY_OPTIONS, ChatV2GatewayAdapter) as {
      namespace?: string;
    };

    expect(gatewayOptions.namespace).toBe(CHAT_WS_NAMESPACES.V2);
    expect(gatewayOptions.namespace).toBe('ws-v2');
  });
});
