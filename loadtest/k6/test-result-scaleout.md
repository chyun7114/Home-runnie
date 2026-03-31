# Scale-out WebSocket 부하테스트 결과 (동일 시나리오)

## 1. 한 줄 결론

**Scale-out은 분명 효과가 있었고, 특히 실패율 방어와 tail latency 완화에 유효했다.**  
다만 **capacity line이 사라진 것은 아니며**, 25~30 iters/s 구간에서는 지연 기반 포화 징후가 남아 있다.

## 2. 실행 조건

- 일자: 2026-03-31
- 시나리오: 단일 baseline과 동일 (`ws-chat.js`)
- 플로우: `connect/authenticated -> join_room -> message -> disconnect`
- 스크립트: `loadtest/k6/ws-chat.js`
- 실행 스크립트: `loadtest/k6/run-capacity-matrix.ps1`
- 결과 경로: `loadtest/k6/results/20260331-230306`
- 토큰: 50개 (`ACCESS_TOKENS` 재생성)

## 3. Capacity Matrix 결과

| profile | rate_target | auth_success | join_success | msg_roundtrip_success | p95_ms | p99_ms | ws_error_count | dropped_iterations | max_active_vus | iterations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sla8 | 10 | 100.00% | 100.00% | 100.00% | 14 | 39 | 0 | 0 | 25 | 969 |
| sla8 | 15 | 100.00% | 100.00% | 100.00% | 13 | 54 | 0 | 0 | 33 | 1369 |
| sla8 | 20 | 100.00% | 100.00% | 100.00% | 15 | 39 | 0 | 0 | 42 | 1769 |
| sla8 | 25 | 100.00% | 100.00% | 100.00% | 42 | 632 | 0 | 0 | 73 | 2169 |
| sla8 | 30 | 100.00% | 100.00% | 100.00% | 360 | 1667 | 0 | 7 | 101 | 2562 |
| diag15 | 10 | 100.00% | 100.00% | 100.00% | 24 | 56 | 0 | 0 | 33 | 969 |
| diag15 | 15 | 100.00% | 100.00% | 100.00% | 41 | 1569 | 0 | 0 | 65 | 1369 |
| diag15 | 20 | 100.00% | 100.00% | 100.00% | 21 | 70 | 0 | 0 | 42 | 1769 |
| diag15 | 25 | 100.00% | 100.00% | 100.00% | 1016 | 3074 | 0 | 23 | 121 | 2146 |
| diag15 | 30 | 100.00% | 100.00% | 100.00% | 1804 | 3310 | 0 | 43 | 140 | 2526 |

## 4. 전체 해석

- 안정 구간 확대: 단일에서 붕괴 시작점이던 `20 iters/s`가 scale-out에서 안정 구간으로 전환.
- 실패보다 지연이 먼저 증가하는 구조는 유지: 성공률 100%여도 고부하에서 tail latency와 dropped가 증가.
- 처리 여유 증가 신호 확인: `max_active_vus`가 단일 대비 크게 감소.

## 5. 구간별 해석

- `10~20 iters/s`: 사실상 안정권.
- `25 iters/s`: 성공률은 방어되지만 tail latency가 올라오기 시작하는 경계 구간.
- `30 iters/s`: 기술적 성공률은 유지되나 UX 기준으로는 포화 접근 구간.

## 6. 단일 인스턴스 대비 비교 해석 (`test-result.md`)

- `25~30 iters/s` 구간 성공률 방어: 단일 대비 안정적(100%).
- `max_active_vus` 감소: 예) `sla8@30` 단일 `287` -> scale-out `101`.
- tail latency 완화: 예) `diag15@30` p95 `3803ms` -> `1804ms`.
- 붕괴 양상 변화: 단일의 실패형 붕괴가 scale-out에서 지연형 포화로 이동.

## 7. 운영 관점 결론

- 안전 운용선: `20 iters/s 이하`
- 주의 운용선: `25 iters/s`
- 스트레스 구간: `30 iters/s`

## 8. 한계 및 보완 포인트

- 재현성 확보 필요: 각 rate 3회 반복 후 median/worst/variance 비교 권장.
- 단계별 분해 필요: auth/join/message roundtrip을 별도 p95/p99로 분리 계측 필요.
- 인스턴스 선형성 확인 필요: 1/2/3대 동일 매트릭스 비교로 scaling efficiency 정량화 권장.

## 9. 다음 실험 우선순위

1. 1/2/3 인스턴스 동일 매트릭스 정식 비교
2. 단계별 지연 분해 계측(auth/join/message)
3. 인프라 상관분석(CPU, event loop lag, Redis, DB pool, 네트워크)
4. Redis ON/OFF(또는 local broadcast) 비교 실험
5. room fan-out 패턴별 실험(1:1, 1:N, 동일 room 집중, 다수 room 분산)
