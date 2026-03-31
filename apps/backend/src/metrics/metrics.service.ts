import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { monitorEventLoopDelay } from 'node:perf_hooks';

type FailureReason =
  | 'auth_timeout'
  | 'auth_invalid_token'
  | 'auth_profile_lookup_fail'
  | 'join_room_not_found'
  | 'join_permission_fail'
  | 'message_timeout'
  | 'socket_disconnected_before_ack';

type BrokerType = 'redis' | 'mq';
type BrokerPublishResult = 'ok' | 'fail';
type BrokerPublishRoute = 'connection' | 'message';
type V2MessageResult = 'accepted' | 'rejected';
type V2MessageReason = 'none' | 'broker_unavailable';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly registry = new Registry();
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  private readonly socketStartedAt = new Map<string, number>();

  private readonly wsHandshakeDurationMs = new Histogram({
    name: 'ws_handshake_duration_ms',
    help: 'Handshake start to authenticated emit duration',
    labelNames: ['result'],
    buckets: [5, 10, 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000],
    registers: [this.registry],
  });

  private readonly wsJoinDurationMs = new Histogram({
    name: 'ws_join_room_duration_ms',
    help: 'join_room receive to message_history emit duration',
    labelNames: ['result'],
    buckets: [5, 10, 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000],
    registers: [this.registry],
  });

  private readonly wsMessageDurationMs = new Histogram({
    name: 'ws_message_process_duration_ms',
    help: 'message receive to ack/echo emit duration',
    labelNames: ['result'],
    buckets: [5, 10, 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000],
    registers: [this.registry],
  });

  private readonly wsSessionDurationMs = new Histogram({
    name: 'ws_session_duration_ms',
    help: 'socket connection open to disconnect duration',
    buckets: [100, 300, 500, 1000, 3000, 5000, 10000, 30000, 60000],
    registers: [this.registry],
  });

  private readonly dbQueryDurationMs = new Histogram({
    name: 'db_query_duration_ms',
    help: 'Database query duration by type',
    labelNames: ['query_type', 'result'],
    buckets: [1, 3, 5, 10, 20, 50, 100, 300, 500, 1000, 3000],
    registers: [this.registry],
  });

  private readonly wsFailureCounter = new Counter({
    name: 'ws_failure_total',
    help: 'WebSocket failure count by reason',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  private readonly wsBrokerPublishCounter = new Counter({
    name: 'ws_broker_publish_total',
    help: 'Broker publish result count by broker and route',
    labelNames: ['broker', 'result', 'route'],
    registers: [this.registry],
  });

  private readonly wsV2MessageResultCounter = new Counter({
    name: 'ws_v2_message_result_total',
    help: 'V2 message handling result count',
    labelNames: ['result', 'reason'],
    registers: [this.registry],
  });

  private readonly connectedSocketsGauge = new Gauge({
    name: 'ws_connected_sockets',
    help: 'Current number of connected sockets',
    registers: [this.registry],
  });

  private readonly activeRoomsGauge = new Gauge({
    name: 'ws_active_rooms',
    help: 'Current number of active rooms',
    registers: [this.registry],
  });

  private readonly pendingMessageGauge = new Gauge({
    name: 'ws_pending_message_jobs',
    help: 'Current number of pending message handlers',
    registers: [this.registry],
  });

  private readonly eventLoopLagMs = new Gauge({
    name: 'node_event_loop_lag_ms',
    help: 'Node event loop lag in milliseconds',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'app_',
    });

    this.eventLoopDelay.enable();
    setInterval(() => {
      const lagMs = this.eventLoopDelay.mean / 1e6;
      this.eventLoopLagMs.set(Number.isFinite(lagMs) ? lagMs : 0);
      this.eventLoopDelay.reset();
    }, 5000).unref();
  }

  onModuleDestroy() {
    this.eventLoopDelay.disable();
  }

  metricsText() {
    return this.registry.metrics();
  }

  contentType() {
    return this.registry.contentType;
  }

  onSocketConnected(socketId: string) {
    this.socketStartedAt.set(socketId, Date.now());
    this.connectedSocketsGauge.inc();
  }

  onSocketDisconnected(socketId: string) {
    const startedAt = this.socketStartedAt.get(socketId);
    if (startedAt) {
      this.wsSessionDurationMs.observe(Date.now() - startedAt);
      this.socketStartedAt.delete(socketId);
    }
    this.connectedSocketsGauge.dec();
  }

  setActiveRoomCount(count: number) {
    this.activeRoomsGauge.set(Math.max(0, count));
  }

  observeHandshake(durationMs: number, result: 'ok' | 'fail') {
    this.wsHandshakeDurationMs.observe({ result }, durationMs);
  }

  observeJoin(durationMs: number, result: 'ok' | 'fail') {
    this.wsJoinDurationMs.observe({ result }, durationMs);
  }

  observeMessage(durationMs: number, result: 'ok' | 'fail') {
    this.wsMessageDurationMs.observe({ result }, durationMs);
  }

  async measureDbQuery<T>(queryType: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      this.dbQueryDurationMs.observe(
        { query_type: queryType, result: 'ok' },
        Date.now() - startedAt,
      );
      return result;
    } catch (error) {
      this.dbQueryDurationMs.observe(
        { query_type: queryType, result: 'fail' },
        Date.now() - startedAt,
      );
      throw error;
    }
  }

  incFailure(reason: FailureReason) {
    this.wsFailureCounter.inc({ reason });
  }

  incBrokerPublish(broker: BrokerType, result: BrokerPublishResult, route: BrokerPublishRoute) {
    this.wsBrokerPublishCounter.inc({ broker, result, route });
  }

  incV2MessageResult(result: V2MessageResult, reason: V2MessageReason = 'none') {
    this.wsV2MessageResultCounter.inc({ result, reason });
  }

  incPendingMessage() {
    this.pendingMessageGauge.inc();
  }

  decPendingMessage() {
    this.pendingMessageGauge.dec();
  }
}
