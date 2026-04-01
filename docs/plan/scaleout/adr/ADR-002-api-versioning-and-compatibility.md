# ADR-002: v2 API 버저닝 및 호환성 정책 (Scale-out 전용)

- 상태: Accepted
- 날짜: 2026-03-31
- 작성자: Backend Team
- 관련 문서:
  - `docs/scaleout/websocket-scaleout-plan.md`
  - `docs/scaleout/adr/ADR-001-mq-selection.md`

## 1. 배경

Scale-out 실험을 진행하면서 기존 사용자 트래픽에 영향을 주지 않기 위해,
기존 API(v1)는 변경하지 않고 신규 API(v2)로 분리 운영해야 한다.

또한 TDD 기반으로 v1 회귀 안정성과 v2 실험 속도를 동시에 확보할 필요가 있다.

## 2. 결정

1. 기존 API(v1)는 기능/스키마/이벤트 계약을 변경하지 않는다.
2. scale-out 관련 변경은 v2 API로만 구현한다.
3. v2는 헥사고날 아키텍처 기반으로 구현하여 인프라 교체 가능성을 보장한다.

## 3. 버저닝 정책

### 3.1 HTTP

- v1: `/api/v1/...` (또는 기존 경로 유지)
- v2: `/api/v2/...`

### 3.2 WebSocket

- v1 namespace: 기존 namespace 유지
- v2 namespace: `/ws-v2` 또는 `/chat-v2` 사용

### 3.3 이벤트 계약

- v1 이벤트 payload/ack 포맷 변경 금지
- v2 이벤트는 명시적 버전 필드 또는 namespace로 구분

## 4. 호환성 원칙

1. v1 클라이언트는 코드 수정 없이 동일 동작해야 한다.
2. v2 기능 추가가 v1 성능/안정성에 영향을 주면 안 된다.
3. 공통 도메인 로직 공유는 가능하되, 입출력 계약은 버전별로 분리한다.

## 5. 구현 가이드 (Hexagonal)

- Application/Domain은 버전 비의존적으로 유지한다.
- 버전 차이는 Adapter 계층에서 처리한다.
- 예시:
  - `ChatV1GatewayAdapter`
  - `ChatV2GatewayAdapter`
  - 공통 유스케이스 `SendMessageUseCase`

## 6. 테스트 정책 (TDD)

### 6.1 필수 테스트 세트

1. v1 회귀 E2E 테스트
2. v2 신규 기능 E2E 테스트
3. v1/v2 계약 테스트(이벤트 스키마/응답 코드/에러 형태)
4. 부하 테스트 비교(동일 시나리오, 버전별 결과 분리)

### 6.2 병합 게이트

- PR 머지 조건:
  - v1 회귀 테스트 100% 통과
  - v2 신규 테스트 통과
  - 성능 임계치 하락 시 승인 불가(예외 승인 정책 필요)

## 7. 배포/운영 정책

1. 초기에는 v2를 내부 테스트/제한 사용자에게만 노출
2. v2 안정화 후 점진적 트래픽 확대
3. 모니터링은 버전 라벨로 분리 집계
   - 예: `api_version=v1|v2`

## 8. 관측 지표 분리

- 공통 지표에 버전 라벨 추가:
  - `ws_join_room_duration_ms{api_version=...}`
  - `ws_message_process_duration_ms{api_version=...}`
  - `ws_failure_total{api_version=...,reason=...}`

목적:

- v2 개선 효과를 v1과 혼동 없이 비교
- 장애 발생 시 영향 범위 즉시 식별

## 9. 리스크 및 대응

- 리스크: v1/v2 코드 중복 증가
  - 대응: 유스케이스/도메인 공통화, Adapter만 분리
- 리스크: 운영 라우팅 복잡도 증가
  - 대응: ingress/nginx 라우팅 규칙 문서화 및 자동 테스트
- 리스크: 버전별 메트릭 누락
  - 대응: 지표 템플릿화 및 대시보드 검증 체크리스트 운영

## 10. 재검토 조건

1. v2가 사실상 기본 경로가 되어 v1 유지 비용이 과도해질 때
2. 클라이언트 전환 완료로 v1 종료 계획이 가능한 시점
3. 신규 요구사항이 v2/v3 분리를 필요로 할 때

## 11. 종료 전략(향후)

1. v2 안정화 지표 충족 후 v1 deprecation 공지
2. 일정 기간 병행 운영
3. v1 트래픽 0에 수렴하면 v1 종료
