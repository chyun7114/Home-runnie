# 0단계 가드레일 (v1 동결 + v2 경계 고정)

상위 공통 규칙은 [프로젝트 공통 지침](../project-global-guidelines.md)을 따른다.

## 범위

- v1 채팅 계약은 변경하지 않는다.
- v2 라우트/네임스페이스는 동작 노출 없이 예약만 한다.
- 머지 시점에 v1 경계 회귀 검증을 수행한다.

## 고정 경계

- v1 HTTP 채팅 기본 경로: `chat`
- v1 WebSocket 네임스페이스: `chat`
- v2 HTTP 채팅 예약 경로: `api/v2/chat`
- v2 WebSocket 예약 네임스페이스: `ws-v2`

## 검증 명령

```bash
pnpm --filter @homerunnie/backend exec jest src/chat/chat.versioning.spec.ts
pnpm --filter @homerunnie/backend exec jest src/chat/chat.contract.spec.ts
```

## 실행 규칙

- 가드레일 검증을 위해 전용 npm/pnpm 스크립트를 새로 만들지 않는다.
- 대상 테스트 파일을 직접 지정해서 실행한다.
- 테스트 파일을 추가/수정한 경우, 반드시 대상 파일 기준 ESLint 검증까지 통과해야 한다.
- ESLint 검증 예시:
  - `pnpm --filter @homerunnie/backend exec -- eslint src/chat/chat.contract.spec.ts`

## 병합 규칙

- v1 채팅 기본 경로 또는 네임스페이스를 변경하는 PR은, ADR을 먼저 갱신하지 않으면 가드레일 테스트에서 반드시 실패해야 한다.
- v1 계약 테스트 파일 변경 시, 테스트 통과와 ESLint 통과 결과를 PR 본문에 함께 기록한다.
