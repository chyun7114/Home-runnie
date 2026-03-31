export const API_VERSION = {
  V1: 'v1',
  V2: 'v2',
} as const;

export const CHAT_ROUTES = {
  V1_HTTP_BASE_PATH: 'chat',
  V2_HTTP_BASE_PATH: `api/${API_VERSION.V2}/chat`,
} as const;

export const CHAT_WS_NAMESPACES = {
  V1: 'chat',
  V2: 'ws-v2',
} as const;
