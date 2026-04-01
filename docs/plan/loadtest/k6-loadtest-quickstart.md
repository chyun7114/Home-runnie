# k6 부하테스트 실행 가이드 (시딩 포함)

## 0) 위치

- 아래 명령은 기본적으로 **레포 루트**(`Home-runnie`)에서 실행

## 1) 모니터링/백엔드 기동

```bash
docker compose -f docker-compose.loadtest.yaml up -d
```

확인:

```bash
docker compose -f docker-compose.loadtest.yaml ps
```

## 2) DB 시딩

```bash
pnpm --filter @homerunnie/backend db:seed
```

## 3) k6용 다중 유저 토큰 생성

예: 50명, roomId=1

```bash
pnpm --filter @homerunnie/backend k6:env -- --count 50 --room 1
```

생성 결과:

- `loadtest/.env.k6`의 `ACCESS_TOKENS`에 자동 반영

## 4) 필요 시 테스트 값 확인/수정

파일:

- `loadtest/.env.k6`

주요 값:

- `BACKEND_HTTP_URL=http://localhost:3030`
- `ROOM_ID=1`
- `ACCESS_TOKENS=...`

## 5) k6 실행

```bash
k6 run loadtest/k6/ws-chat.js
```

## 6) 모니터링 확인

- Grafana: `http://localhost:3001` (`admin` / `admin`)
- 확인 대시보드:
  - `Loadtest - System`
  - `Loadtest - Container`
  - `Loadtest - Database`

## 7) 테스트 종료

```bash
docker compose -f docker-compose.loadtest.yaml down
```

## 8) S9 backlog alert check

```bash
powershell -File loadtest/k6/check-backlog-alert.ps1 -PrometheusUrl http://localhost:9090 -Lookback 10m -OutputPath loadtest/k6/backlog-alert-summary.md
```

- Exit code `0`: OK
- Exit code `1`: Warning
- Exit code `2`: Critical
