import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

function parseDotEnv(content) {
  const out = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile() {
  try {
    return parseDotEnv(open('../.env.k6'));
  } catch (_) {
    return {};
  }
}

const FILE_ENV = loadEnvFile();
const env = (key, fallback) => {
  const fromRuntime = __ENV[key];
  if (fromRuntime !== undefined && fromRuntime !== '') return fromRuntime;
  const fromFile = FILE_ENV[key];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return fallback;
};

const connectRate = new Rate('ws_connect_success_rate');
const authRate = new Rate('ws_auth_success_rate');
const joinRate = new Rate('ws_join_success_rate');
const messageRate = new Rate('ws_message_roundtrip_success_rate');
const sessionRate = new Rate('ws_session_success_rate');
const wsErrorCount = new Counter('ws_error_count');
const roundTripTrend = new Trend('ws_message_roundtrip_ms');
const sessionDurationTrend = new Trend('ws_session_duration_ms');

const ROOM_ID = env('ROOM_ID', '1');
const THINK_TIME_MS = Number(env('THINK_TIME_MS', '1000'));
const LEAVE_DELAY_MS = Number(env('LEAVE_DELAY_MS', '1000'));
const AUTH_TIMEOUT_MS = Number(env('AUTH_TIMEOUT_MS', '8000'));
const JOIN_TIMEOUT_MS = Number(env('JOIN_TIMEOUT_MS', '8000'));
const MESSAGE_TIMEOUT_MS = Number(env('MESSAGE_TIMEOUT_MS', '8000'));

const BASE_HTTP_URL = env('BACKEND_HTTP_URL', 'http://localhost:3030');
const WS_URL = `${BASE_HTTP_URL.replace(/^http/i, 'ws')}/socket.io/?EIO=4&transport=websocket`;
const NAMESPACE = '/chat';

function pickAccessToken() {
  const pool = env('ACCESS_TOKENS', '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (pool.length > 0) {
    const idx = (__VU - 1 + exec.scenario.iterationInTest) % pool.length;
    return pool[idx];
  }
  return env('ACCESS_TOKEN', '');
}

function eventPacket(eventName, payload) {
  return `42${NAMESPACE},${JSON.stringify([eventName, payload])}`;
}

function parseSocketIoEvent(message) {
  const prefix = `42${NAMESPACE},`;
  if (!message.startsWith(prefix)) return null;
  try {
    const decoded = JSON.parse(message.slice(prefix.length));
    if (!Array.isArray(decoded) || decoded.length === 0) return null;
    return { event: decoded[0], payload: decoded[1] };
  } catch (_) {
    return null;
  }
}

export const options = {
  scenarios: {
    ws_join_send_leave: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { target: 5, duration: '1m' },
        { target: 30, duration: '3m' },
        { target: 30, duration: '5m' },
      ],
    },
  },
  thresholds: {
    ws_connect_success_rate: ['rate>0.99'],
    ws_auth_success_rate: ['rate>0.99'],
    ws_join_success_rate: ['rate>0.99'],
    ws_message_roundtrip_success_rate: ['rate>0.99'],
    ws_session_success_rate: ['rate>0.97'],
    ws_message_roundtrip_ms: ['p(95)<800', 'p(99)<1500'],
  },
};

export default function () {
  const token = pickAccessToken();
  const start = Date.now();
  const marker = `[k6] vu=${__VU} iter=${exec.scenario.iterationInTest} ts=${Date.now()}`;
  let sentAt = 0;

  let authOk = false;
  let joinOk = false;
  let messageOk = false;
  let namespaceConnected = false;
  let closed = false;

  const params = {
    headers: {
      Cookie: `accessToken=${encodeURIComponent(token)}`,
      Origin: env('ORIGIN', 'http://localhost:3000'),
    },
    tags: {
      scenario: 'ws_join_send_leave',
      room_id: ROOM_ID,
    },
  };

  const res = ws.connect(WS_URL, params, (socket) => {
    socket.on('open', () => {
      socket.send(`40${NAMESPACE},`);
      socket.setTimeout(() => {
        if (!authOk && !closed) {
          wsErrorCount.add(1);
          socket.close();
        }
      }, AUTH_TIMEOUT_MS);
    });

    socket.on('message', (raw) => {
      const message = String(raw);

      if (message === '2') {
        socket.send('3');
        return;
      }

      if (message.startsWith(`40${NAMESPACE},`)) {
        namespaceConnected = true;
        return;
      }

      const parsed = parseSocketIoEvent(message);
      if (!parsed) return;

      if (parsed.event === 'authenticated') {
        authOk = true;
        authRate.add(true);
        socket.send(eventPacket('join_room', { roomId: ROOM_ID }));
        socket.setTimeout(() => {
          if (!joinOk && !closed) {
            wsErrorCount.add(1);
            socket.close();
          }
        }, JOIN_TIMEOUT_MS);
        return;
      }

      if (parsed.event === 'message_history') {
        joinOk = true;
        joinRate.add(true);
        socket.setTimeout(() => {
          sentAt = Date.now();
          socket.send(eventPacket('message', { roomId: ROOM_ID, message: marker }));
          socket.setTimeout(() => {
            if (!messageOk && !closed) {
              wsErrorCount.add(1);
              socket.close();
            }
          }, MESSAGE_TIMEOUT_MS);
        }, THINK_TIME_MS);
        return;
      }

      if (parsed.event === 'received_message') {
        const payload = parsed.payload || {};
        if (payload.message === marker && payload.isOwn === true) {
          messageOk = true;
          messageRate.add(true);
          if (sentAt > 0) {
            roundTripTrend.add(Date.now() - sentAt);
          }
          socket.setTimeout(() => socket.close(), LEAVE_DELAY_MS);
        }
      }
    });

    socket.on('error', () => {
      wsErrorCount.add(1);
    });

    socket.on('close', () => {
      closed = true;
      if (!authOk) authRate.add(false);
      if (!joinOk) joinRate.add(false);
      if (!messageOk) messageRate.add(false);

      const ok = authOk && joinOk && messageOk;
      sessionRate.add(ok);
      sessionDurationTrend.add(Date.now() - start);
    });
  });

  const connected = check(res, {
    'websocket upgraded': (r) => r && r.status === 101,
  });
  connectRate.add(connected && namespaceConnected);
}
