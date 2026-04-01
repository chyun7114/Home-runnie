# v2 브로커 환경 변수 가이드

## 목적

- v2 경로에서 Redis/RabbitMQ 어댑터를 활성화하기 위한 최소 설정을 정리한다.
- 기본값은 안정성 우선으로 `No-op` 어댑터를 사용한다.

## 기본 동작

- `CHAT_USE_EXTERNAL_BROKERS=false` 또는 미설정:
  - `NoopMessageBusAdapter`
  - `NoopEventPublisherAdapter`
- `CHAT_USE_EXTERNAL_BROKERS=true`:
  - `RedisMessageBusAdapter`
  - `RabbitMqEventPublisherAdapter`

## 필수 환경 변수

```env
CHAT_USE_EXTERNAL_BROKERS=true

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_EXCHANGE=chat.events
```

## 적용 시점

- 로컬/테스트에서 브로커를 함께 띄운 뒤 `CHAT_USE_EXTERNAL_BROKERS=true`를 사용한다.
- 운영 반영 전에는 v2 트래픽 제한 상태에서 연결/종료/재시도 로그를 먼저 확인한다.
