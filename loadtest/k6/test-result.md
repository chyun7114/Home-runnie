# Scale-out 이전 WebSocket 부하테스트 결과 정리

## 1. 목적

- 단일 인스턴스에서 WebSocket 채팅(`입장 -> 메시지 -> 퇴장`)의 처리 한계를 정량화한다.
- 단순 pass/fail이 아니라, 안정 구간과 붕괴 시작 지점(capacity line onset)을 찾는다.
- 이후 scale-out 효과를 비교할 기준선(baseline)을 만든다.

## 2. 테스트 구성

- 부하 도구: `k6`
- 모니터링: `Prometheus + Grafana`
- 실행 모델: `ramping-arrival-rate`
- 부하 단계: `10 / 15 / 20 / 25 / 30 iters/s`
- 비교 프로파일:
  - `sla8`: `AUTH_TIMEOUT_MS=8000` (기능 SLA 기준)
  - `diag15`: `AUTH_TIMEOUT_MS=15000` (원인 분석 기준)

## 3. 측정 지표

- `ws_auth_success_rate`
- `ws_join_success_rate`
- `ws_message_roundtrip_success_rate`
- `ws_message_roundtrip_ms (p95, p99)`
- `ws_error_count`
- `dropped_iterations`
- `max_active_vus`

## 4. Capacity Matrix 결과

출처: `loadtest/k6/results/20260331-114731/matrix-summary.md`

| profile | rate_target | auth_success | join_success | msg_roundtrip_success | p95_ms | p99_ms | ws_error_count | dropped_iterations | max_active_vus | iterations |
| ------- | ----------: | -----------: | -----------: | --------------------: | -----: | -----: | -------------: | -----------------: | -------------: | ---------: |
| sla8    |          10 |      100.00% |      100.00% |               100.00% |    103 |    108 |              0 |                  0 |             22 |        292 |
| sla8    |          15 |      100.00% |      100.00% |               100.00% |    125 |    213 |              0 |                  0 |             33 |        417 |
| sla8    |          20 |      100.00% |       96.54% |                96.54% |  3,452 |  3,927 |             17 |                 51 |            170 |        491 |
| sla8    |          25 |      100.00% |       85.25% |                85.25% |  3,458 |  3,712 |             81 |                118 |            238 |        549 |
| sla8    |          30 |      100.00% |       58.81% |                58.81% |  3,517 |  3,949 |            257 |                168 |            287 |        624 |
| diag15  |          10 |      100.00% |      100.00% |               100.00% |    333 |    746 |              0 |                  0 |             37 |        292 |
| diag15  |          15 |      100.00% |      100.00% |               100.00% |  1,484 |  1,659 |              0 |                  0 |            107 |        417 |
| diag15  |          20 |      100.00% |      100.00% |               100.00% |  2,177 |  2,388 |              0 |                 44 |            163 |        498 |
| diag15  |          25 |      100.00% |       98.41% |                98.41% |  3,588 |  4,404 |              9 |                100 |            220 |        567 |
| diag15  |          30 |      100.00% |       54.76% |                54.76% |  3,803 |  3,982 |            290 |                151 |            270 |        641 |

## 5. 핵심 해석

### 5.1 구간별 해석

- `10 iters/s`: 완전 안정 구간
  - 성공률 100%, dropped 0, 지연도 낮음
- `15 iters/s`: 전조 구간
  - 성공률은 100%이나 `diag15`에서 tail latency(p95/p99) 상승이 보임
  - 즉, 실패는 아직 없지만 지연 누적 신호가 시작됨
- `20 iters/s`: 붕괴 시작선(capacity line onset)
  - `sla8`에서 join/message 실패 시작
  - 지연 급상승, dropped_iterations 발생 시작
- `25 iters/s 이상`: 명확한 과부하 구간
  - 성공률 저하 본격화
  - 지연 수 초대 고착
  - error 증가 + VU 점유 증가 + dropped 증가 동반

### 5.2 sla8 vs diag15 해석

- `20~25 iters/s`에서 `diag15` 성공률이 `sla8`보다 높다.
- 해석: 일부 실패는 로직 오류보다 “느린 응답이 8초 timeout에 걸린 실패” 성격이 크다.
- 주의: `diag15` 성공률이 높아도 시스템이 건강하다는 뜻은 아니다.
  - 예: 25 iters/s에서 `diag15` p95 3.6s, p99 4.4s는 실사용 품질 기준으로 이미 나쁨
  -
- `30 iters/s`에서는 두 프로파일 모두 크게 붕괴하므로, timeout 조정만으로 해결 불가한 단일 인스턴스 한계 구간이다.

### 5.3 ws_auth 관련 결론

- 이번 매트릭스에서는 `ws_auth_success_rate`가 전 구간 100%로 관측되었다.
- 따라서 1차 병목은 인증(쿠키 기반/데코레이터)보다 `join/message` 이후 처리 지연일 가능성이 높다.
- 즉, 문제 공간은 인증보다는 후속 이벤트 처리 경로로 좁혀진다.

### 5.4 dropped_iterations / max_active_vus 해석

- rate가 올라갈수록 세션 처리시간이 길어지고 VU 반환이 지연된다.
- `ramping-arrival-rate` 특성상 목표 rate를 맞추기 위해 더 많은 VU를 요구하게 되며,
  결과적으로 `max_active_vus`와 `dropped_iterations`가 함께 증가한다.
- 이는 “부하 생성기 문제 단독”이라기보다 “서버 지연 증가 + VU 점유 증가 + 생성기 한계 접근”이 결합된 신호다.

## 6. 지표 해석 시 주의사항

- `join_success`와 `msg_roundtrip_success`는 본 시나리오에서 구조적으로 강하게 연동된다.
  - join 성공 후에만 message roundtrip 단계가 진행되기 때문이다.
- `iterations` 수치가 rate_target별로 완전히 같지 않은 것은 정상이다.
  - dropped 발생, VU 점유 시간 증가, 시나리오 종료 타이밍 차이로 완료 iteration 수가 달라질 수 있다.

## 7. 서버 계측 추가 현황 (Prometheus)

### 7.1 타이머/히스토그램

- `ws_handshake_duration_ms{result}`
- `ws_join_room_duration_ms{result}`
- `ws_message_process_duration_ms{result}`
- `ws_session_duration_ms`
- `db_query_duration_ms{query_type,result}`

### 7.2 실패 카운터

- `ws_failure_total{reason}`
  - `auth_timeout`
  - `auth_invalid_token`
  - `auth_profile_lookup_fail`
  - `join_room_not_found`
  - `join_permission_fail`
  - `message_timeout`
  - `socket_disconnected_before_ack`

### 7.3 게이지

- `ws_connected_sockets`
- `ws_active_rooms`
- `ws_pending_message_jobs`
- `node_event_loop_lag_ms`

## 8. 최종 결론 (Scale-out 이전 기준선)

- 안정 운영선: `15 iters/s 이하`
- 붕괴 시작선: `20 iters/s 부근`
- 명확한 과부하 구간: `25 iters/s 이상`
- `30 iters/s`는 timeout 완화로도 회복되지 않는 단일 인스턴스 한계 구간
- 따라서 scale-out의 목표는 평균 응답 개선보다, **붕괴 시작선을 오른쪽으로 이동**시키는 것이다.

## 9. 다음 단계 (Scale-out 검증)

1. 동일 매트릭스(10/15/20/25/30)를 1/2/3 인스턴스로 반복 실행
2. 인스턴스 수별 capacity line 이동량 비교
3. `ws_failure_total{reason}` + `ws_join_room_duration_ms` + `ws_message_process_duration_ms`로 병목 원인 최종 분리
