# WebSocket 부하테스트 실행 절차 (단일 인스턴스)

## 0. 범위

- 목적: 단일 인스턴스에서 채팅 WebSocket 성능 baseline 확보
- 기준 플로우: `connect/authenticated -> join_room -> message -> disconnect`
- 제약: AWS 프리티어(변경 이전) 수준 자원 제한을 먼저 적용

## 1. 사전 준비

1. 테스트 대상 방 1개를 미리 준비한다. (예: `roomId=1`)
2. 테스트 계정 20~100개를 준비한다.
3. 각 계정의 `accessToken`을 확보한다.
4. 테스트 시간 동안 앱 로그/DB 모니터링이 가능하도록 준비한다.

### 1-1. 시딩 유저 토큰 자동 생성 (권장)

1. 시딩을 먼저 실행한다.
   - `pnpm --filter @homerunnie/backend db:seed`
2. k6 env 파일에 다중 토큰을 자동 생성한다.
   - `pnpm --filter @homerunnie/backend k6:env -- --count 50 --room 1`
3. 생성 결과는 `loadtest/.env.k6`의 `ACCESS_TOKENS`에 반영된다.

## 2. 컨테이너 자원 제한 적용

1. 루트에 `docker-compose.free-tier.yaml` 파일을 만든다.
2. 아래 제한을 사용한다.

```yaml
services:
  backend:
    cpus: '0.50'
    mem_limit: 512m
    mem_reservation: 384m
    pids_limit: 256
    ulimits:
      nofile:
        soft: 65535
        hard: 65535

  postgres:
    cpus: '0.30'
    mem_limit: 384m
    mem_reservation: 256m
    pids_limit: 128
```

3. 아래 명령으로 기동한다.

```bash
docker compose -f docker-compose.yaml -f docker-compose.free-tier.yaml up -d
```

4. 기동 후 상태를 확인한다.

```bash
docker compose ps
docker stats --no-stream
```

## 3. 테스트 툴 선택

- 확정: `k6` 사용
- 모니터링 확정: `Prometheus + Grafana` 사용
- 본 런북의 모든 실행/보고는 위 조합을 기준으로 한다

## 3-1. 모니터링 준비 (Prometheus + Grafana)

1. Prometheus scrape interval을 `15s`로 설정한다.
2. backend/postgres/host 메트릭 수집 대상이 정상 등록되었는지 확인한다.
3. Grafana 대시보드 3종을 준비한다.
   - System: CPU, Memory, Network
   - Container: backend/postgres CPU, MEM, restart count
   - Database: connection, latency
4. 테스트 시작/종료 시간을 기록해 Grafana와 k6 결과 구간을 동일하게 맞춘다.
5. Grafana에서 아래 자동 생성 대시보드를 확인한다.
   - `Loadtest - System`
   - `Loadtest - Container`
   - `Loadtest - Database`

## 4. 테스트 데이터 정책

1. 메시지 포맷은 고정 접두어를 사용한다.
   - 예: `loadtest-{vu}-{timestamp}`
2. 방 ID는 고정 1개로 먼저 측정하고, 이후 3~10개 방으로 확장한다.
3. 각 VU는 입장 후 최소 1건 메시지를 전송한다.

## 5. 실행 시나리오 순서

### 5-1. 시나리오 A (기본 플로우)

1. Warm-up 1분: `2~5 user/s`
2. Ramp-up 3분: `5 -> 30 user/s`
3. Sustain 5분: `30 user/s`
4. 성공률/지연/리소스를 기록한다.

### 5-1-1. k6 실행 절차 (기본 플로우)

1. `loadtest/.env.k6` 파일에 테스트 값을 입력한다.
   - 샘플: `loadtest/.env.k6.example`
2. 표준 실행 명령으로 실행한다. (`.env.k6`는 스크립트에서 자동 로드)

```bash
k6 run loadtest/k6/ws-chat.js
```

3. 일시적으로 값만 덮어쓰고 싶으면 `-e`를 사용한다.

```bash
k6 run -e ROOM_ID=2 loadtest/k6/ws-chat.js
```

4. 다중 토큰을 사용할 경우 `ACCESS_TOKENS`를 사용한다.
   - 예: `token1,token2,token3`

### 5-2. 시나리오 B (장기 연결)

1. 동시 접속 목표치를 고정한다. (예: 300, 500)
2. 각 연결은 2~5분 유지한다.
3. 10~20초 간격으로 메시지를 보낸다.
4. 메모리 추세와 disconnect 비율을 기록한다.

### 5-3. 시나리오 C (Burst)

1. 짧은 구간에 동시 입장을 집중한다.
2. 10~20초 고밀도 전송 후 빠르게 종료한다.
3. p95/p99, DB 지연 급등 여부를 본다.

### 5-4. 시나리오 D (재연결)

1. 연결 중 일부 세션을 강제 종료한다.
2. 즉시 재연결 후 재입장/재전송을 시도한다.
3. 재연결 성공률과 메시지 누락을 확인한다.

## 6. 관측 항목 수집

### 앱 레벨

- `authenticated` 성공률
- `join_room` 성공률
- `message` 전송 후 `received_message` 수신률
- 강제 disconnect 비율
- k6 커스텀 메트릭
  - `ws_connect_success_rate`
  - `ws_auth_success_rate`
  - `ws_join_success_rate`
  - `ws_message_roundtrip_success_rate`
  - `ws_message_roundtrip_ms`
  - `ws_session_success_rate`

### 인프라 레벨

- CPU 평균/피크
- 메모리 평균/피크
- 네트워크 in/out
- DB connection 수, insert latency

## 7. 종료/합격 기준

1. 합격 예시
   - 성공률 `>= 99%`
   - `p95 <= 800ms`, `p99 <= 1500ms`
   - OOM/재시작 없음
2. 중단 예시
   - 에러율 `> 2%` 1분 이상
   - `p99 > 3s` 3분 이상
   - 메모리 `> 95%` 지속

## 7-1. k6 기본 임계치(스크립트 내 반영)

- `ws_connect_success_rate > 0.99`
- `ws_auth_success_rate > 0.99`
- `ws_join_success_rate > 0.99`
- `ws_message_roundtrip_success_rate > 0.99`
- `ws_message_roundtrip_ms p(95) < 800ms`
- `ws_message_roundtrip_ms p(99) < 1500ms`

## 8. 결과 기록 템플릿

1. 테스트 ID: `YYYYMMDD-A/B/C/D-01`
2. 환경: 인스턴스 타입, 이미지 태그, DB 버전
3. 부하값: arrivalRate, sustain 시간, 동시접속
4. 결과: 성공률, p95/p99, max CPU, max MEM
5. 장애 포인트: 최초 악화 시점과 지표
6. 다음 액션: 튜닝 항목 1~3개

## 9. 운영 전 연결

1. baseline 대비 1.5배 부하에서 재측정한다.
2. 병목 지표가 반복되면 scale-out 기준을 확정한다.
3. 예: CPU 70%+ 5분, p95 800ms 초과 시 확장 트리거.
4. 본 절차는 scale-in(축소)이 아니라 scale-out(수평 확장) 의사결정을 위한 병목 탐색 절차임을 명시한다.
