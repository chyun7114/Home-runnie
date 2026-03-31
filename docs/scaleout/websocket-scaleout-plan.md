# WebSocket Scale-out 실행 계획 (TDD + v2 + Hexagonal)

## 1. 목표

- 단일 인스턴스 기준선 대비, 다중 인스턴스에서 capacity line(붕괴 시작선) 우측 이동을 검증한다.
- 기존 API(v1)는 변경하지 않고, scale-out 실험은 v2 API로 분리 수행한다.
- Redis/MQ 연동은 헥사고날 아키텍처(Port/Adapter)로 설계해 교체 가능한 구조를 만든다.

## 2. 필수 조건

### 2.1 TDD 방식

- 구현 전 테스트를 먼저 작성한다.
- 기본 루프: `Red -> Green -> Refactor`.
- 테스트 레벨:
  - 단위 테스트: 도메인 로직, 포트 인터페이스 계약
  - 통합 테스트: Redis adapter, MQ adapter, DB 연동
  - E2E 테스트: v2 WebSocket 입장/메시지/퇴장 시나리오

### 2.2 API 버전 정책

- v1 API는 동작/스키마/계약을 변경하지 않는다.
- scale-out 전용 경로는 v2로 신규 제공한다.
- 예시:
  - HTTP: `/api/v2/...`
  - WS namespace: `/ws-v2` 또는 `/chat-v2`

### 2.3 헥사고날 아키텍처 적용

- Domain/Application은 인프라 의존성을 직접 참조하지 않는다.
- Port(인터페이스)와 Adapter(구현체)를 분리한다.
- 예시 포트:
  - `MessageBusPort` (publish/subscribe)
  - `RoomStatePort` (room membership, fan-out)
  - `EventPublisherPort` (비동기 이벤트 발행)
- 예시 어댑터:
  - `RedisPubSubAdapter`
  - `RabbitMqAdapter` (또는 선정된 MQ의 adapter)

## 3. MQ 선정 당위성(ADR 방식)

## 3.1 후보

- Redis Streams
- RabbitMQ
- Kafka
- AWS SQS/SNS

## 3.2 선정 기준

- 실시간 채팅 후처리에 필요한 저지연 처리
- 운영 복잡도(초기 구축/장애 대응/학습 비용)
- 메시지 전달 보장 수준(ack/retry/dead-letter)
- 관측 가능성(메트릭/큐 깊이/처리량 추적)
- 현재 팀 역량 및 실험 속도

## 3.3 권장안

- 실시간 fan-out: Redis Pub/Sub(Socket.IO Redis adapter)
- 후처리 MQ: RabbitMQ

선정 이유:

1. Kafka 대비 운영 복잡도가 낮아 PoC/실험 속도가 빠르다.
2. SQS 대비 로컬/도커 실험 환경에서 재현성과 제어성이 높다.
3. ack/retry/DLQ 구성이 쉬워 실패 분석과 테스트가 용이하다.
4. scale-out 초기 단계에서 필요한 기능 대비 비용 효율이 좋다.

## 3.4 문서화 산출물

- `docs/scaleout/adr/ADR-001-mq-selection.md` 작성
- 후보별 장단점, 탈락 사유, 최종 선택 근거, 재검토 조건 명시

## 4. 단계별 실행 절차

### 4.1 1단계: 설계 확정

1. v1/v2 경계 정의(라우트, DTO, 이벤트 스키마)
2. Port/Adapter 인터페이스 설계
3. Redis fan-out 경로와 MQ 후처리 경로 분리 설계
4. Nginx sticky session 정책 확정

산출물:

- 아키텍처 다이어그램
- 포트 인터페이스 명세
- v2 API 스펙 초안

### 4.2 2단계: TDD 기반 구현

1. 도메인/유스케이스 테스트 먼저 작성
2. v2 API 최소 기능 구현(입장/메시지/퇴장)
3. Redis adapter 연결
4. MQ adapter 연결(후처리 이벤트)
5. 리팩터링 및 테스트 고정

산출물:

- 테스트 코드(단위/통합/E2E)
- v2 구현 코드

### 4.3 3단계: 인프라 구성 (Docker Compose)

1. `backend-v2` 2~3개 컨테이너
2. `nginx` upstream + sticky + websocket 설정
3. `redis`, `rabbitmq`, `postgres`, `prometheus`, `grafana` 통합
4. 프리티어 유사 리소스 제한/헬스체크 적용

산출물:

- `docker-compose.scaleout.yaml`
- `infra/loadtest/nginx/nginx.conf`
- `infra/loadtest/prometheus/prometheus.yml`

### 4.4 4단계: 부하테스트 실행

- 기존 기준선과 동일한 매트릭스 유지:
  - `10 / 15 / 20 / 25 / 30 iters/s`
  - `sla8` / `diag15`
- 비교군:
  - v1 단일 인스턴스(기준선)
  - v2 2 인스턴스
  - v2 3 인스턴스

확인 지표:

- `ws_auth_success_rate`
- `ws_join_success_rate`
- `ws_message_roundtrip_success_rate`
- `ws_message_roundtrip_ms (p95/p99)`
- `ws_error_count`
- `dropped_iterations`
- `max_active_vus`
- `ws_failure_total{reason}`

산출물:

- `loadtest/k6/results/<timestamp>/matrix-summary.md`
- 인스턴스별 비교표

### 4.5 5단계: 결과 정리

1. 안정 운영선 / 붕괴 시작선 / 과부하 구간 재정의
2. scale-out 전/후 capacity line 이동량 수치화
3. timeout 영향(`sla8` vs `diag15`) 분리 해석
4. 병목 원인 최종 결론(join/message/DB/Redis/MQ)

산출물:

- `loadtest/k6/test-result-scaleout.md`

## 5. 성공 판정 기준

- v1 API 무변경 보장(회귀 테스트 통과)
- v2 API에서 scale-out 동작 안정화
- 붕괴 시작선이 단일 인스턴스 기준(약 20 iters/s)보다 우측 이동
- 동일 부하에서 p95/p99 개선
- 동일 부하에서 `dropped_iterations` 감소

## 6. 리스크 및 대응

- 리스크: sticky session 미설정으로 WS 재연결 불안정
  - 대응: LB sticky 정책 강제 + websocket upgrade 검증
- 리스크: MQ 도입으로 핵심 경로 복잡도 증가
  - 대응: 핵심 채팅 경로는 동기 처리 최소화, 후처리만 MQ 분리
- 리스크: 생성기 한계와 서버 한계 혼재
  - 대응: `maxVUs` 상향 + 부하 생성기 리소스 모니터링 병행

## 7. 체크리스트

- [ ] v1 API 회귀 테스트 통과
- [ ] v2 API 스펙 확정
- [ ] Port/Adapter 인터페이스 정의
- [ ] Redis adapter 적용 완료
- [ ] MQ adapter 적용 완료
- [ ] Nginx sticky + websocket 설정 완료
- [ ] 1/2/3 인스턴스 테스트 완료
- [ ] MQ 선정 ADR 문서화 완료
- [ ] scale-out 전/후 비교 보고서 작성 완료
