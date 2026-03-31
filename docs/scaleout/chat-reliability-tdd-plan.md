# 채팅 신뢰성 TDD 계획 (우선 예외 기반)

## 1. 목적

- `chat-exception-example.md`의 예외 중 서비스 장애/데이터 불일치 위험이 큰 항목을 우선 적용한다.
- 예외 시나리오를 테스트로 먼저 고정하고(TDD), 구현을 그 뒤에 맞춘다.
- 핵심 보장: **실시간 전송 실패 메시지는 MQ/DB 저장 경로로 흘러가면 안 된다.**

## 2. 우선순위 선정 기준

- 데이터 정합성에 직접 영향(중복, 유실, 순서 역전)
- 사용자 체감 장애(메시지 미전송/지연/오표시)
- 운영 리스크(브로커 장애, DB 장애, 재시도 폭주)
- 구현 대비 효과(짧은 주기로 검증 가능한지)

## 3. 중요 예외 Top 10 (chat-exception-example 기반)

### P0 (즉시 대응)

1. Redis 전송 실패 후 MQ/DB로 진행되는 불일치
2. Redis 성공, MQ 실패로 인한 전달-저장 불일치
3. MQ 소비 성공 후 DB 저장 실패(재시도/DLQ 미정의)
4. MQ 재전달/클라이언트 재전송에 의한 중복 저장
5. 메시지 순서 역전(멀티 인스턴스/비동기 처리)

### P1 (다음 스프린트)

6. 인증 만료/권한 없음 상태에서 subscribe/send 허용
7. 잘못된 payload(JSON/필수 필드/크기 초과) 처리 누락
8. reconnect 중 메시지 유실(gap recovery 없음)
9. Presence/읽음 상태 불일치(ghost session, unread 역전)
10. 브로커 backlog로 인한 지연 급증(p95/p99 악화)

## 4. 정합성 처리 정책 (확정)

1. `v2_message` 수신
2. payload 검증 실패 시 즉시 reject
3. **Redis publish 먼저 수행**
4. Redis 실패 시:
   - MQ 발행 금지
   - DB 저장 경로 진입 금지
   - `v2_message_rejected(reason=redis_publish_failed)`
5. Redis 성공 시 MQ publish
6. MQ 실패 시:
   - DB 저장 경로 진입 금지
   - `v2_message_rejected(reason=mq_publish_failed)`
7. Redis+MQ 성공 시 `v2_message_accepted`
8. MQ consumer에서 DB 저장:
   - idempotency key 검사 후 저장
   - 실패 시 retry, 한도 초과 시 DLQ

## 5. 테스트 전략 (TDD)

- 기본 루프: `Red -> Green -> Refactor`
- 원칙: 모든 분기(성공/실패/경계)별 테스트를 먼저 작성

### 5.1 단위 테스트

- Redis 실패 시 MQ 미호출
- Redis 성공 후 MQ 호출 순서 보장
- MQ 실패 시 reject 이벤트 반환
- payload 검증 실패 코드/사유 검증

### 5.2 통합 테스트

- 브로커 mock 기반 실패 주입(Redis down, MQ down)
- 실패 사유 이벤트(`v2_message_rejected`) 검증
- 성공 시 `v2_message_accepted` 검증

### 5.3 E2E 테스트

- 실제 Redis/RabbitMQ 컨테이너 환경에서 발행 확인
- 브로커 비활성/활성 모드 분기 확인
- `/health` 및 v1 회귀 영향 없음 확인

## 6. 시나리오-테스트 매핑

| ID  | 시나리오                 | 기대 결과               | 테스트 레벨 |
| --- | ------------------------ | ----------------------- | ----------- |
| S1  | Redis 실패               | MQ 미호출 + rejected    | 단위/통합   |
| S2  | Redis 성공, MQ 실패      | DB 저장 없음 + rejected | 단위/통합   |
| S3  | MQ 소비 후 DB 실패       | retry 후 DLQ            | 통합        |
| S4  | 중복 전달/재전송         | DB 1회 저장(idempotent) | 단위/통합   |
| S5  | 순서 역전 입력           | 서버 순서 규칙 유지     | 통합        |
| S6  | reconnect 중 유실        | gap recovery 동작       | 통합/E2E    |
| S7  | payload 이상             | validation error        | 단위        |
| S8  | 권한 없음 send/subscribe | forbidden/rejected      | 통합/E2E    |
| S9  | 브로커 backlog           | 지표 악화 감지 및 알람  | 성능 테스트 |
| S10 | v2 장애 중 v1 트래픽     | v1 회귀 통과            | E2E         |

## 7. 단계별 실행 계획

### 1단계 (지금)

- S1/S2/S7 구현 및 테스트 고정
- 현재 코드의 순차 보장(Redis -> MQ) 유지 검증

### 2단계

- S3: MQ consumer + retry/DLQ 경로 구현
- S4: idempotency key 설계/적용

### 3단계

- S5/S6: 순서 보장, reconnect gap recovery
- S8: 권한/구독 예외 강화

### 4단계

- S9/S10: 성능/회귀 자동화 및 CI 게이트

## 8. 머지 게이트

- S1~S2는 항상 필수 통과
- 변경 범위에 해당하는 시나리오 테스트 누락 시 머지 금지
- v1 회귀 실패 시 머지 금지
- PR 본문에 아래 필수 기재
  - 추가/수정 시나리오 ID
  - 실행한 테스트 명령
  - 실패 처리 정책 변경 여부

## 9. 즉시 액션 아이템

1. S2(“Redis 성공, MQ 실패”)를 실브로커/모의 모두에서 검증
2. MQ consumer 경로(저장/재시도/DLQ) 설계 문서 추가
3. idempotency key 스키마 초안 작성

## 10. 진행 현황 (2026-03-31)

- S2 시나리오 테스트 확장 완료
- 단위: `chat-v2.gateway.adapter.spec.ts`
  - Redis 성공 후 MQ 실패 시 `v2_message_rejected` 검증
  - 메트릭 `redis ok`, `mq fail`, `rejected` 호출 검증
- 통합: `chat-v2.gateway.integration.spec.ts`
  - Redis 성공 후 MQ 실패 소켓 응답(`v2_message_rejected`) 검증
- E2E: `chat-v2-metrics-failure.e2e-spec.ts`
  - Redis 실패 경로 메트릭 증가 검증 유지
  - Redis 성공 후 MQ 실패 경로 메트릭 증가 검증 추가
