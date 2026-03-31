import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const connectRate = new Rate('v2_ws_connect_success_rate');
const readyRate = new Rate('v2_ws_ready_success_rate');
const messageRate = new Rate('v2_ws_message_success_rate');
const sessionRate = new Rate('v2_ws_session_success_rate');
const wsErrorCount = new Counter('v2_ws_error_count');
const roundTripTrend = new Trend('v2_ws_message_roundtrip_ms');

const BASE_HTTP_URL = __ENV.BACKEND_HTTP_URL || 'http://localhost:3030';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:3000';
const ROOM_ID = __ENV.ROOM_ID || '10';
const SENDER_ID = Number(__ENV.SENDER_ID || '1');
const THINK_TIME_MS = Number(__ENV.THINK_TIME_MS || '300');
const READY_TIMEOUT_MS = Number(__ENV.READY_TIMEOUT_MS || __ENV.AUTH_TIMEOUT_MS || '5000');
const MESSAGE_TIMEOUT_MS = Number(__ENV.MESSAGE_TIMEOUT_MS || '5000');
const RATE_START = Number(__ENV.RATE_START || '2');
const RATE_WARMUP_TARGET = Number(__ENV.RATE_WARMUP_TARGET || '5');
const RATE_TARGET = Number(__ENV.RATE_TARGET || '20');
const STAGE_WARMUP = __ENV.STAGE_WARMUP || '20s';
const STAGE_RAMP = __ENV.STAGE_RAMP || '40s';
const STAGE_SUSTAIN = __ENV.STAGE_SUSTAIN || '60s';
const K6_PREALLOCATED_VUS = Number(__ENV.K6_PREALLOCATED_VUS || '50');
const K6_MAX_VUS = Number(__ENV.K6_MAX_VUS || '300');

const WS_URL = `${BASE_HTTP_URL.replace(/^http/i, 'ws')}/socket.io/?EIO=4&transport=websocket`;
const NAMESPACE = '/ws-v2';

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
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    ws_v2_send_leave: {
      executor: 'ramping-arrival-rate',
      startRate: RATE_START,
      timeUnit: '1s',
      preAllocatedVUs: K6_PREALLOCATED_VUS,
      maxVUs: K6_MAX_VUS,
      stages: [
        { target: RATE_WARMUP_TARGET, duration: STAGE_WARMUP },
        { target: RATE_TARGET, duration: STAGE_RAMP },
        { target: RATE_TARGET, duration: STAGE_SUSTAIN },
      ],
    },
  },
  thresholds: {
    v2_ws_connect_success_rate: ['rate>0.99'],
    v2_ws_ready_success_rate: ['rate>0.99'],
    v2_ws_message_success_rate: ['rate>0.99'],
    v2_ws_session_success_rate: ['rate>0.97'],
    v2_ws_message_roundtrip_ms: ['p(95)<1000', 'p(99)<2000'],
  },
};

export default function () {
  const marker = `[v2-k6] vu=${__VU} iter=${exec.scenario.iterationInTest} ts=${Date.now()}`;
  const lbToken = `lb-vu-${__VU}`;
  let namespaceConnected = false;
  let readyOk = false;
  let messageOk = false;
  let closed = false;
  let sentAt = 0;

  const params = {
    headers: {
      Cookie: `accessToken=${encodeURIComponent(lbToken)}`,
      Origin: ORIGIN,
    },
    tags: {
      scenario: 'ws_v2_send_leave',
      room_id: ROOM_ID,
    },
  };

  const res = ws.connect(WS_URL, params, (socket) => {
    socket.on('open', () => {
      socket.send(`40${NAMESPACE},`);
      socket.setTimeout(() => {
        if (!readyOk && !closed) {
          wsErrorCount.add(1);
          socket.close();
        }
      }, READY_TIMEOUT_MS);
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

      if (parsed.event === 'v2_ready') {
        readyOk = true;
        readyRate.add(true);
        socket.setTimeout(() => {
          sentAt = Date.now();
          socket.send(
            eventPacket('v2_message', { roomId: ROOM_ID, message: marker, senderId: SENDER_ID }),
          );
          socket.setTimeout(() => {
            if (!messageOk && !closed) {
              wsErrorCount.add(1);
              socket.close();
            }
          }, MESSAGE_TIMEOUT_MS);
        }, THINK_TIME_MS);
        return;
      }

      if (parsed.event === 'v2_message_accepted') {
        const payload = parsed.payload || {};
        if (payload.roomId === ROOM_ID && payload.accepted === true) {
          messageOk = true;
          messageRate.add(true);
          if (sentAt > 0) {
            roundTripTrend.add(Date.now() - sentAt);
          }
          socket.close();
        }
      }
    });

    socket.on('error', () => {
      wsErrorCount.add(1);
    });

    socket.on('close', () => {
      closed = true;
      if (!readyOk) readyRate.add(false);
      if (!messageOk) messageRate.add(false);
      sessionRate.add(readyOk && messageOk);
    });
  });

  const connected = check(res, {
    'websocket upgraded': (r) => r && r.status === 101,
  });
  connectRate.add(connected && namespaceConnected);
}
