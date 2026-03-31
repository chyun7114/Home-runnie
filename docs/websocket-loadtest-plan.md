# 단일 인스턴스 WebSocket 부하테스트 계획서

## 1) 질문에 대한 결론
- `입장(join) -> 채팅(message) -> 퇴장(disconnect)` 시퀀스는 **좋은 1차 기준 시나리오**입니다.
- 현재 백엔드 이벤트 기준으로 보면 실제 순서는 아래처럼 잡는 것이 정확합니다.
  1. 소켓 연결 + 인증 성공(`authenticated`)
  2. 방 입장 이벤트(`join_room`)
  3. 메시지 전송 이벤트(`message`)
  4. 연결 종료(클라이언트 disconnect)
- 단, 운영 근접 검증을 위해서는 1차 시나리오 외에 아래 확장 시나리오(장기 접속, burst, 재연결)까지 포함하는 것을 권장합니다.

## 2) 테스트 목표
- 단일 인스턴스에서 WebSocket 동시 접속 처리 한계 확인
- 메시지 처리량(초당 메시지 수)과 지연시간 확인
- 에러율(인증 실패, 메시지 누락, disconnect 증가) 임계점 확인
- scale-out 이전 기준 성능선(baseline) 확보
- 병목 지점을 수치로 특정하고, 해당 지점을 scale-out(수평 확장)으로 분산해 해결 가능한지 검증
- scale-in(축소)과 달리, 본 계획은 과부하 구간 완화를 위해 인스턴스 추가 방향의 확장 전략을 검증하는 데 초점

## 2-1) 도구 표준
- 부하테스트 도구는 `k6`로 고정
- 모니터링 스택은 `Prometheus + Grafana` 조합으로 고정
- 결과 보고 시 애플리케이션 지표(k6)와 인프라 지표(Prometheus)를 함께 비교해 병목 지점을 판정
- k6 기준 스크립트 경로: `loadtest/k6/ws-chat.js`
- k6 테스트 환경변수 파일: `loadtest/.env.k6` (샘플: `loadtest/.env.k6.example`)
- 표준 실행 방식: `k6 run loadtest/k6/ws-chat.js`

## 3) 환경 제약 (AWS 프리티어, 변경 이전 기준 반영)
- 기준 인스턴스: `t2.micro` 또는 `t3.micro` (vCPU 1, Memory 1GiB)
- 운영체제/도커 오버헤드 고려 시, 앱 컨테이너에 전체 자원을 모두 할당하면 안 됨
- 권장 리소스 가이드(단일 인스턴스 내 백엔드+DB 동시 구동 가정)
  - Backend: `0.40~0.50 vCPU`, `384~512MiB`
  - Postgres: `0.25~0.35 vCPU`, `256~384MiB`
  - OS + Docker + 버퍼: `150~250MiB` 이상 확보

## 4) docker-compose 제한안 (적용 예시)
아래는 **override 파일**(`docker-compose.free-tier.yaml`)로 적용하는 것을 권장합니다.

```yaml
services:
  backend:
    cpus: "0.50"
    mem_limit: 512m
    mem_reservation: 384m
    pids_limit: 256
    ulimits:
      nofile:
        soft: 65535
        hard: 65535
    restart: unless-stopped

  postgres:
    cpus: "0.30"
    mem_limit: 384m
    mem_reservation: 256m
    pids_limit: 128
    restart: unless-stopped
```

실행 예시:
```bash
docker compose -f docker-compose.yaml -f docker-compose.free-tier.yaml up -d
```

## 5) 부하테스트 시나리오

### 시나리오 A: 기본 사용자 플로우 (필수)
- 목적: 정상 사용자 행동 기준 성능 확인
- 흐름:
  1. 연결/인증 성공 대기
  2. `join_room` 1회
  3. 메시지 1건 전송
  4. 1~2초 유지 후 disconnect
- 부하 패턴:
  - Warm-up 1분: 2~5 user/s
  - Ramp-up 3분: 5 -> 30 user/s
  - Sustain 5분: 30 user/s
- 구현 기준:
  - Socket.IO 네임스페이스 `/chat`
  - 이벤트 순서 `authenticated -> join_room -> message -> received_message -> disconnect`

### 시나리오 B: 장기 접속 + 간헐 메시지
- 목적: 연결 유지 비용(메모리/FD) 측정
- 흐름:
  1. 입장 후 2~5분 연결 유지
  2. 10~20초마다 메시지 전송
  3. 테스트 종료 시 순차 disconnect
- 핵심 지표: 동시 접속 수 대비 메모리 증가량, disconnect 비율

### 시나리오 C: Burst 전송
- 목적: 순간 트래픽 내성 확인
- 흐름:
  1. 짧은 시간에 다수 유저 동시 입장
  2. 10~20초 동안 집중 메시지 전송
  3. 급격한 종료
- 핵심 지표: p95/p99 지연, DB write 지연, 에러율 급증 구간

### 시나리오 D: 재연결 복원력
- 목적: 네트워크 불안정 상황 검증
- 흐름:
  1. 입장/전송 중 일부 세션 강제 끊기
  2. 즉시 재연결 후 재입장/재전송
- 핵심 지표: 재연결 성공률, 중복 전송/누락 여부

## 6) 측정 항목 (필수)
- 애플리케이션
  - 인증 성공률
  - `join_room` 성공률
  - `message` ack/수신 성공률
  - 에러율(4xx/5xx 성격 이벤트, 강제 disconnect)
- 성능
  - 메시지 왕복 지연 p50/p95/p99
  - 초당 처리량(messages/sec)
  - 동시 접속 수(concurrent sockets)
- 인프라
  - CPU 사용률(평균/피크)
  - 메모리 사용률(평균/피크, OOM 여부)
  - 네트워크 in/out
  - DB connections, insert latency

## 6-1) 모니터링 수집 기준 (Prometheus + Grafana)
- Prometheus 수집 주기: 15초 권장
- Grafana 대시보드는 최소 아래 3개로 구성
  - `System`: CPU, 메모리, 네트워크, 디스크 I/O
  - `Container`: backend/postgres 컨테이너 CPU, 메모리, restart
  - `Database`: connections, transaction/insert latency
- 테스트 리포트에는 k6 요약값(p50/p95/p99, error rate)과 같은 시각 구간의 Grafana 지표를 같이 첨부

## 7) 합격/중단 기준 예시
- 합격 예시
  - 인증/입장/메시지 성공률 >= 99.0%
  - 메시지 p95 <= 800ms, p99 <= 1500ms
  - 10분 sustain 중 OOM/프로세스 재시작 없음
- 중단(병목 판단) 예시
  - 에러율 > 2%가 1분 이상 지속
  - p99 > 3초가 3분 이상 지속
  - 인스턴스 메모리 95% 이상 지속

## 8) 실행 순서 제안
1. 시나리오 A로 baseline 확보
2. A 성공 구간의 1.5배로 상향해 임계점 파악
3. 시나리오 B/C/D로 운영 리스크 구간 확인
4. 결과 기반으로 scale-out 기준치 정의
   - 예: CPU 70% 초과 5분 지속 + p95 800ms 초과 시 수평 확장

## 9) 주의사항
- 같은 인스턴스에서 부하 생성기까지 같이 돌리면 결과가 왜곡될 수 있음
- 가능하면 부하 생성기는 별도 노드/로컬 머신에서 실행
- 인증 쿠키(`accessToken`)를 쓰는 현재 구조 특성상, 테스트 계정/토큰 준비가 선행되어야 함
