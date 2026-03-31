# ADR-001: Scale-out 환경 MQ 선택

- 상태: Accepted
- 날짜: 2026-03-31
- 작성자: Backend Team
- 관련 문서: `docs/scaleout/websocket-scaleout-plan.md`

## 1. 배경

WebSocket 채팅 scale-out 실험에서 실시간 fan-out과 비동기 후처리를 분리해야 한다.
현재 목표는 다음과 같다.

- v1 API는 변경하지 않고 v2 API에서 scale-out 검증
- TDD 기반으로 빠르게 실험/검증 가능한 구조 확보
- 헥사고날 아키텍처 기반으로 MQ/브로커 교체 가능성 보장

## 2. 의사결정 범위

본 ADR은 "후처리 이벤트 전달용 MQ" 선택에 대한 결정이다.
참고로 실시간 fan-out은 Redis Pub/Sub(Socket.IO Redis adapter)로 별도 사용한다.

## 3. 선택지

1. Redis Streams
2. RabbitMQ
3. Kafka
4. AWS SQS/SNS

## 4. 평가 기준

1. 초기 도입/운영 복잡도
2. 로컬/도커 기반 재현성
3. 메시지 전달 제어(ack/retry/DLQ)
4. 관측 가능성(큐 깊이/처리량/실패 추적)
5. 팀 숙련도 및 실험 속도
6. scale-out 1차 검증 목적 적합성

## 5. 비교 요약

### 5.1 Redis Streams

- 장점:
  - Redis 인프라를 이미 사용하는 경우 통합이 쉬움
  - 지연이 낮고 개발이 빠름
- 단점:
  - MQ 고유 운영 패턴(정교한 라우팅/복잡한 재시도 체계)은 상대적으로 제한
  - fan-out Redis와 책임이 섞일 수 있음

### 5.2 RabbitMQ

- 장점:
  - ack/retry/DLQ 구성 용이
  - 라우팅 패턴(topic/direct) 활용성 높음
  - Docker 기반 로컬 실험 재현성 우수
  - Kafka 대비 운영 복잡도 낮음
- 단점:
  - Redis 단독 대비 컴포넌트 1개 추가 운영 필요

### 5.3 Kafka

- 장점:
  - 고처리량/내구성/재처리 생태계 강점
- 단점:
  - 초기 운영 복잡도와 학습비용이 큼
  - 현재 "scale-out 1차 검증" 단계 대비 과투자 가능성

### 5.4 AWS SQS/SNS

- 장점:
  - 관리형 서비스로 운영 부담 감소
  - AWS 연동성 우수
- 단점:
  - 로컬 재현성이 낮음(LocalStack 등 추가 필요)
  - 실험 속도와 디버깅 편의성이 떨어질 수 있음

## 6. 결정

후처리 MQ는 **RabbitMQ**를 채택한다.

동시에 실시간 fan-out은 **Redis Pub/Sub(Socket.IO Redis adapter)** 를 사용한다.

즉, 역할을 다음처럼 분리한다.

- Redis: WebSocket 실시간 브로드캐스트 동기화
- RabbitMQ: 알림/로그 파이프라인/비핵심 후처리 이벤트 비동기 처리

## 7. 결정 근거

1. 현재 단계의 최우선 목표는 "빠른 scale-out 검증"이며 RabbitMQ가 가장 균형적이다.
2. retry/DLQ/ack를 통해 실패 시나리오 테스트(TDD)에 유리하다.
3. 로컬 Docker Compose 환경에서 실험 반복이 쉽다.
4. Kafka 대비 운영 복잡도를 낮추면서도 메시지 처리 제어력을 확보할 수 있다.
5. 헥사고날 구조를 적용하면 추후 Kafka/SQS 전환도 가능하다.

## 8. 구현 원칙 (Hexagonal)

- 애플리케이션 레이어는 MQ 구현체를 직접 참조하지 않는다.
- `EventPublisherPort`를 정의하고 RabbitMQ는 `RabbitMqAdapter`로 구현한다.
- 테스트에서는 인메모리/fake adapter로 대체 가능해야 한다.
- Redis adapter와 MQ adapter는 서로 역할을 침범하지 않는다.

## 9. 영향

- 긍정:
  - 실험 속도 향상
  - 실패 원인 분리(실시간 경로 vs 후처리 경로)
  - TDD 친화적 구조 확보
- 비용:
  - 운영 컴포넌트(RabbitMQ) 추가
  - 초기 adapter/포트 구현 비용 발생

## 10. 재검토 조건

아래 조건 중 하나 충족 시 ADR 재검토:

1. 처리량 요구가 RabbitMQ 단일 구성 한계를 지속 초과
2. 이벤트 재처리/로그 분석 요구가 스트림 플랫폼 중심으로 전환
3. 조직 표준 메시징이 Kafka/SQS로 강제되는 경우
4. 운영비/복잡도 관점에서 대체안이 명확히 우위인 경우

## 11. 검증 계획

1. v2 scale-out 환경에서 10/15/20/25/30 iters/s 매트릭스 수행
2. `ws_failure_total{reason}`와 MQ 처리 지표를 함께 비교
3. capacity line 이동 및 p95/p99 개선 여부로 의사결정 검증
