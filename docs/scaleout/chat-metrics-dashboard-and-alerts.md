# 채팅 V2 메트릭 대시보드 및 알람 기준

## 목적

- V2 채팅 경로에서 브로커 발행 성공/실패를 실시간으로 관찰한다.
- 메시지 수락/거절 비율을 기반으로 장애를 빠르게 감지한다.
- Redis 성공 후 MQ 실패 같은 정합성 위험 신호를 조기에 탐지한다.

## 핵심 메트릭

- `ws_broker_publish_total{broker, result, route}`
- `ws_v2_message_result_total{result, reason}`

## 대시보드 패널 제안

1. 분당 메시지 수락/거절 추이

- 수락

```promql
sum(rate(ws_v2_message_result_total{result="accepted"}[1m]))
```

- 거절

```promql
sum(rate(ws_v2_message_result_total{result="rejected"}[1m]))
```

2. 브로커별 메시지 발행 성공/실패

- Redis 성공/실패

```promql
sum(rate(ws_broker_publish_total{broker="redis",route="message",result="ok"}[1m]))
sum(rate(ws_broker_publish_total{broker="redis",route="message",result="fail"}[1m]))
```

- MQ 성공/실패

```promql
sum(rate(ws_broker_publish_total{broker="mq",route="message",result="ok"}[1m]))
sum(rate(ws_broker_publish_total{broker="mq",route="message",result="fail"}[1m]))
```

3. 메시지 거절율(1분)

```promql
sum(rate(ws_v2_message_result_total{result="rejected"}[1m]))
/
clamp_min(sum(rate(ws_v2_message_result_total{result=~"accepted|rejected"}[1m])), 0.001)
```

4. 정합성 위험 지표(Redis 성공 대비 MQ 성공 차이)

```promql
sum(rate(ws_broker_publish_total{broker="redis",route="message",result="ok"}[1m]))
-
sum(rate(ws_broker_publish_total{broker="mq",route="message",result="ok"}[1m]))
```

## 알람 기준(초안)

1. 브로커 실패 급증

- 조건

```promql
sum(rate(ws_broker_publish_total{route="message",result="fail"}[1m])) > 1
```

- 유지 시간: `for 2m`
- 심각도: `warning`

2. 메시지 거절율 상승

- 조건

```promql
(
  sum(rate(ws_v2_message_result_total{result="rejected"}[1m]))
  /
  clamp_min(sum(rate(ws_v2_message_result_total{result=~"accepted|rejected"}[1m])), 0.001)
) > 0.05
```

- 유지 시간: `for 3m`
- 심각도: `warning`

3. 메시지 전송 중단 수준

- 조건

```promql
sum(rate(ws_v2_message_result_total{result="rejected"}[1m])) > 5
```

- 유지 시간: `for 1m`
- 심각도: `critical`

4. Redis-MQ 정합성 위험

- 조건

```promql
(
  sum(rate(ws_broker_publish_total{broker="redis",route="message",result="ok"}[1m]))
  -
  sum(rate(ws_broker_publish_total{broker="mq",route="message",result="ok"}[1m]))
) > 1
```

- 유지 시간: `for 2m`
- 심각도: `critical`

## 운영 체크리스트

- 장애 알람 발생 시 먼저 `v2_message_rejected` 이벤트를 샘플링해 `reason` 분포를 확인한다.
- Redis 실패가 먼저 늘었는지, MQ 실패가 먼저 늘었는지 순서를 확인한다.
- Redis 성공 대비 MQ 성공 격차가 지속되면 메시지 유실/중복 가능성을 즉시 점검한다.
- 배포 직후 10분 동안은 거절율과 브로커 실패율을 집중 모니터링한다.
