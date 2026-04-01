채팅 서비스에서 나올 수 있는 예외상황은 생각보다 엄청 많아.
보통은 아래 7개 축으로 보면 정리가 잘 된다.

1. **연결 자체의 예외**
2. **인증/인가 예외**
3. **메시지 송수신 예외**
4. **방 입장/퇴장/구독 예외**
5. **순서/중복/정합성 예외**
6. **확장 환경(멀티 서버, Redis, MQ) 예외**
7. **운영/보안/UX 예외**

아래처럼 보면 된다.

---

# 1. 연결 단계에서의 예외

채팅은 보통 HTTP → WebSocket 업그레이드 → 세션 유지 흐름이라서, 연결 자체에서 많이 터진다.

## 1-1. WebSocket 핸드셰이크 실패

예:

- 잘못된 엔드포인트로 접속
- 프록시/Nginx 설정 문제
- CORS / Origin 정책 불일치
- ws:// 와 wss:// 혼용
- 헤더 누락
- 서버가 업그레이드 요청을 처리 못함

증상:

- 연결이 아예 안 됨
- 브라우저에서 websocket connection failed
- 서버에는 400, 403, 404, 500 계열

대응:

- 핸드셰이크 실패 로그를 별도 분리
- origin, path, scheme 검증
- reverse proxy websocket upgrade 설정 점검

---

## 1-2. 연결 타임아웃

예:

- 서버 과부하로 handshake 지연
- LB/Nginx idle timeout
- 모바일 네트워크 불안정
- DNS/SSL 지연

증상:

- 사용자는 “연결 중...” 상태
- 결국 연결 실패 또는 재시도 반복

대응:

- connect timeout / read timeout 구분
- heartbeat 설정
- 연결 실패 시 exponential backoff 재시도

---

## 1-3. 비정상 연결 종료

예:

- 브라우저 종료
- 탭 강제 종료
- 앱 백그라운드 전환
- 네트워크 순간 끊김
- 서버 재시작/배포
- LB가 커넥션 드랍

증상:

- 유저는 나간 적 없는데 서버에서는 disconnect
- 유령 접속(ghost session) 발생 가능

대응:

- disconnect 이벤트를 신뢰하되, 마지막 heartbeat 기준으로 정리
- presence는 TTL 기반으로 관리
- 끊김 후 자동 재접속 설계

---

# 2. 인증/인가 관련 예외

채팅은 그냥 연결만 된다고 끝이 아니라, “누가 어떤 방에 들어갈 수 있느냐”가 중요하다.

## 2-1. 토큰 누락/만료/위조

예:

- Authorization 헤더 없음
- access token 만료
- query param token 누락
- 서명 위조
- refresh 없이 오래 연결 유지

증상:

- 연결 거부
- 연결은 됐는데 메시지 전송 시 인증 실패
- 중간에 갑자기 강제 종료

대응:

- 연결 시 1차 인증
- 메시지 수신 시 사용자 컨텍스트 재검증
- 만료 시 명확한 에러 코드 반환
- 장기 연결일 경우 재인증 정책 필요

---

## 2-2. 인가 실패

예:

- 초대받지 않은 방 입장
- 이미 차단된 사용자
- 비공개 채팅방 접근
- 관리자만 가능한 이벤트 호출
- 탈퇴한 사용자의 재접속

증상:

- 특정 방 입장 실패
- 메시지 전송만 막힘
- 서버에서 forbidden

대응:

- connect 시점 + subscribe 시점 + send 시점 모두 인가 검증
- “연결 가능”과 “방 접근 가능”은 분리해서 생각

---

# 3. 메시지 전송/수신 단계 예외

여기가 핵심이다. 실제 UX를 무너뜨리는 건 대부분 여기서 생긴다.

## 3-1. 잘못된 메시지 형식

예:

- JSON 파싱 실패
- 필수 필드 누락
- roomId 없음
- senderId 없음
- messageType 오타
- timestamp 포맷 오류

증상:

- 서버에서 역직렬화 예외
- 특정 메시지만 처리 실패
- 클라이언트는 보냈다고 생각하지만 반영 안 됨

대응:

- DTO validation
- 에러 응답 표준화
- schema version 관리

---

## 3-2. 메시지 크기 초과

예:

- 너무 긴 텍스트
- 대용량 이미지 base64 전송
- 파일 첨부를 채팅 payload로 직접 보냄
- 악의적 대용량 payload

증상:

- 서버 메모리 사용량 증가
- 프레임 분할/수신 실패
- 연결 강제 종료 가능

대응:

- 최대 메시지 크기 제한
- 파일은 별도 업로드 후 URL만 전달
- payload size validation

---

## 3-3. 빈 메시지 / 의미 없는 메시지

예:

- 공백만 있는 메시지
- 제어문자만 포함
- 이모지 조합만 수백 개
- 줄바꿈만 여러 개

대응:

- trim 후 빈 문자열 체크
- Unicode 조합 문자 처리
- UX 관점에서 허용 범위 정의

---

## 3-4. 금지어/악성 메시지

예:

- 욕설
- 광고/스팸
- 피싱 링크
- XSS 유도 문자열
- SQL injection 같은 공격성 입력

증상:

- 운영 리스크
- 다른 사용자 UI 깨짐
- 관리자 신고 증가

대응:

- 입력 검증
- HTML escape/sanitize
- 링크 필터링
- 신고/차단 시스템

---

# 4. 채팅방 입장/퇴장/구독 관련 예외

## 4-1. 존재하지 않는 방 입장

예:

- roomId 잘못됨
- 이미 삭제된 방
- 아직 생성 전인데 먼저 구독 시도

대응:

- room existence check
- soft delete 상태 체크
- stale client state 정리

---

## 4-2. 중복 입장

예:

- 같은 사용자가 같은 방에 여러 탭으로 접속
- 재접속 과정에서 기존 세션 정리 안 됨
- subscribe 요청이 중복 전송됨

문제:

- 인원 수가 뻥튀기됨
- 메시지를 여러 번 받음
- 입장 이벤트가 중복 브로드캐스트됨

대응:

- userId + roomId 기준 중복 세션 정책 정의
- 허용인지, 단일 세션만 허용인지 결정
- presence와 session count 구분

---

## 4-3. 퇴장 처리 실패

예:

- 클라이언트가 정상 퇴장 요청 없이 종료
- 서버 예외로 퇴장 이벤트 누락
- Redis/DB 상태 정리 실패

문제:

- 유저가 나갔는데 온라인으로 남아 있음
- 방 인원 수 불일치
- 마지막 읽음 위치나 unread 계산 꼬임

대응:

- 명시적 leave + 비정상 종료 둘 다 처리
- presence는 TTL/heartbeat 기반으로 보정

---

## 4-4. 구독만 하고 입장은 안 한 상태

예:

- STOMP subscribe는 했는데 room membership 검증 누락
- 권한 없는 destination 구독

문제:

- 몰래 메시지 수신 가능
- 보안 취약점

대응:

- subscribe interceptor에서 room membership 검사

---

# 5. 메시지 저장/조회 관련 예외

## 5-1. DB 저장 실패

예:

- DB connection pool 부족
- deadlock
- 장애
- transaction rollback
- unique 제약 조건 충돌

문제:

- 실시간으로는 보였는데 새로고침하면 메시지 없음
- 일부 사용자에게만 보이고 영속화 안 됨

대응:

- “전송 성공”과 “저장 성공” 상태 분리 가능
- 저장 실패 시 retry / DLQ / 보상 처리 고려
- 최소한 서버 내부에서 delivery status 관리

---

## 5-2. 저장은 됐는데 브로드캐스트 실패

예:

- DB commit 성공 후 broker publish 실패
- Redis pub/sub 전파 실패
- 특정 노드 장애

문제:

- 기록은 있는데 실시간 화면에 안 뜸

대응:

- outbox 패턴 고려
- 저장과 전파의 원자성 문제 인식
- 재전송 루틴 필요

---

## 5-3. 브로드캐스트는 됐는데 저장 실패

예:

- 먼저 소켓 송신하고 나중에 DB 저장
- 저장 중 예외 발생

문제:

- 사용자는 메시지를 봤는데 히스토리에는 없음

대응:

- 가능한 저장 후 전송
- 또는 pending/sent/persisted 상태 구분

---

## 5-4. 이전 메시지 조회 실패

예:

- paging cursor 오류
- 삭제된 메시지 참조
- 오래된 방 조회 시 성능 저하
- N+1 쿼리
- unread 계산 쿼리 병목

문제:

- 방 입장 시 로딩 오래 걸림
- 과거 대화 일부 누락
- 스크롤 복원 실패

---

# 6. 순서 보장 / 중복 / 유실 문제

이건 채팅에서 진짜 중요하다.

## 6-1. 메시지 순서 뒤바뀜

원인:

- 멀티 스레드 처리
- 여러 서버 인스턴스
- 브로커 지연 편차
- 클라이언트 timestamp 신뢰
- 재전송 메시지가 늦게 도착

증상:

- “안녕” 다음에 “왜?”가 먼저 보임
- 읽음 처리 순서 꼬임

대응:

- 서버 기준 sequence 발급
- room 단위 ordering 전략
- timestamp만으로 정렬하지 않기

---

## 6-2. 중복 메시지

원인:

- 클라이언트 재시도
- ACK 못 받아서 다시 전송
- broker at-least-once
- reconnect 후 resend
- double click / enter 중복 입력

증상:

- 같은 내용이 두 번 찍힘

대응:

- clientMessageId 기반 멱등 처리
- deduplication window
- UI에서도 전송 버튼 debounce

---

## 6-3. 메시지 유실

원인:

- 소켓은 끊겼는데 클라이언트가 모름
- 브로커 publish 실패
- 구독 전 상태에서 메시지 발생
- reconnect 동안 발생한 메시지 missed

대응:

- lastMessageId 기반 gap recovery
- 재접속 후 missed messages 동기화
- ACK/receipt 정책 도입 가능

---

# 7. 읽음 처리 / 안읽음 처리 예외

## 7-1. 읽음 처리 역전

예:

- 메시지 10까지 읽었는데 8로 다시 내려감
- 여러 기기에서 동시 접속
- 늦게 도착한 read event가 최신 상태 덮어씀

대응:

- read position은 max만 반영
- 단순 update가 아니라 greatest 비교

---

## 7-2. unread count 불일치

원인:

- 실시간 수신은 했지만 읽음 반영 안 됨
- 멀티 디바이스 상태 충돌
- 시스템 메시지까지 unread에 포함
- 퇴장/재입장 시 기준점 꼬임

증상:

- 이미 읽었는데 1 남아 있음
- 반대로 안 읽었는데 0 표시

대응:

- unread 계산 기준 명확화
- 읽음 이벤트 idempotent 처리
- 시스템 메시지 제외 여부 정의

---

# 8. 멀티 서버/스케일 아웃 환경 예외

단일 인스턴스에서는 잘 되는데 scale-out 하면 터지는 것들이다.

## 8-1. 서버마다 세션 정보가 다름

예:

- 유저 A는 1번 서버에 연결
- 유저 B는 2번 서버에 연결
- 메시지를 1번 서버에서만 브로드캐스트

문제:

- 일부 사용자만 메시지를 봄

대응:

- Redis pub/sub
- Kafka 같은 메시지 브로커
- 세션 로컬 관리 + 이벤트 글로벌 전파 분리

---

## 8-2. sticky session 의존

문제:

- 특정 서버로만 붙는 걸 전제로 개발
- 재연결 시 다른 서버로 가면 상태 불일치

대응:

- 서버 로컬 메모리에만 중요한 상태 두지 않기
- room membership / presence 공유 저장소 활용

---

## 8-3. Redis pub/sub 누락

예:

- Redis 장애
- subscribe thread 문제
- reconnect 중 이벤트 누락

문제:

- 어떤 서버는 메시지를 받고 어떤 서버는 못 받음

대응:

- pub/sub는 휘발성임을 인지
- 유실 복구는 DB 기반 sync 필요

---

## 8-4. 분산 환경에서 중복 발행

예:

- 같은 이벤트를 여러 노드가 동시에 처리
- 리스너가 중복 소비
- failover 중 재처리

대응:

- message id 기반 dedupe
- consumer group / lock / idempotency 설계

---

# 9. 브로커(STOMP, Redis, Kafka 등) 관련 예외

## 9-1. broker backlog

예:

- 트래픽 급증
- 소비 속도 < 생산 속도
- 메시지 큐 적체

증상:

- 실시간성이 무너짐
- p95, p99 급격히 증가
- 한참 뒤에 메시지 도착

대응:

- queue depth 모니터링
- consumer scaling
- 드롭 가능한 이벤트와 아닌 이벤트 구분

---

## 9-2. ACK/NACK 처리 실패

예:

- 클라이언트가 수신 확인 못 보냄
- 서버가 ack 상태 추적 안 함

문제:

- 실제 전달 여부 불명확
- 재전송 기준 अस्पष्ट

대응:

- 최소한 중요한 이벤트는 receipt 도입
- 일반 채팅은 완전 보장보다 UX 우선 여부 결정

---

# 10. 파일/이미지/첨부 메시지 예외

## 10-1. 업로드는 실패했는데 메시지는 전송됨

예:

- 이미지 업로드 중 실패
- 메시지 payload에는 fileUrl이 들어감
- 실제 URL은 invalid

대응:

- 업로드 완료 후 메시지 생성
- 상태값: uploading / uploaded / failed

---

## 10-2. 악성 파일 업로드

예:

- 실행 파일
- 너무 큰 파일
- 확장자 위장
- 바이러스 포함 가능

대응:

- MIME type 검증
- 확장자 검증
- 용량 제한
- 스캔 처리

---

# 11. 사용자 상태(presence) 예외

## 11-1. 온라인/오프라인 상태 불일치

예:

- 연결 끊겼는데 online 표시
- 앱 백그라운드인데 online 유지
- heartbeat 끊겼지만 세션 클린업 지연

대응:

- connection state + heartbeat + TTL 함께 사용
- “지금 온라인”의 정의를 명확히 해야 함

---

## 11-2. 타이핑 표시 꼬임

예:

- typing started만 가고 stopped 안 감
- 사용자는 입력 끝났는데 계속 “입력 중...”

대응:

- typing event는 TTL 짧게
- 서버 저장 X, 휘발성 이벤트로 처리

---

# 12. 시스템 메시지 관련 예외

예:

- “A님 입장”
- “A님 퇴장”
- “방장이 변경되었습니다”

문제:

- 실제 메시지와 동일하게 저장/전달하면 unread 계산 꼬일 수 있음
- 중복 생성될 수 있음

대응:

- 일반 채팅 메시지와 시스템 이벤트 타입 분리
- 저장 여부, unread 포함 여부 분리

---

# 13. 보안 예외

## 13-1. XSS

예:

- `<script>` 삽입
- 링크 미리보기 악용

대응:

- escape/sanitize 필수

## 13-2. 도배/스팸

예:

- 초당 수십 건 메시지
- 봇 접속 반복

대응:

- rate limit
- user/room/IP 기준 throttling

## 13-3. 무차별 방 접근 시도

예:

- roomId 추측
- private destination 구독 시도

대응:

- 인가 체크
- audit log
- 비정상 패턴 탐지

---

# 14. 성능/운영 관점 예외

## 14-1. 느린 소비자(slow consumer)

예:

- 어떤 클라이언트 네트워크가 너무 느림
- 서버 send buffer 적체

문제:

- 메모리 증가
- 전체 처리량 저하 가능

대응:

- send timeout
- buffer 한도
- 너무 느린 세션 강제 종료 정책

---

## 14-2. 커넥션 폭증

예:

- 이벤트/프로모션
- 재접속 폭탄
- 배포 직후 모든 클라이언트 동시 재연결

문제:

- handshake CPU 급증
- connection pool, thread pool, FD 고갈

대응:

- 재접속 jitter
- admission control
- 서버별 connection cap 고려

---

## 14-3. 배포 중 세션 드랍

예:

- 무중단 배포라고 했는데 websocket drain 처리 없음

문제:

- 사용자 대량 disconnect
- 메시지 누락

대응:

- connection draining
- graceful shutdown
- reconnect 이후 missed sync

---

# 15. 비즈니스 정책 예외

## 15-1. 차단 사용자 간 메시지 처리

예:

- 서로 차단한 경우 기존 방 메시지를 보여줄지
- 차단 후 과거 메시지 유지 여부

## 15-2. 삭제된 메시지 처리

예:

- 이미 읽은 사람에게는 보였고 나중에 삭제
- “삭제된 메시지입니다”로 대체할지 완전 삭제할지

## 15-3. 탈퇴 사용자 처리

예:

- 탈퇴 후 닉네임 표시
- 과거 메시지 보존 여부
- 익명화 필요 여부

이건 기술 예외라기보다 정책 미정으로 인해 서비스가 꼬이는 영역이다.

---

# 실무에서 특히 자주 터지는 핵심 예외 10개만 뽑으면

1. 인증 토큰 만료 상태에서 소켓 유지
2. 방 권한 없는 사용자의 subscribe
3. 중복 입장/중복 세션
4. 메시지 JSON 파싱 실패
5. 대용량 payload 전송
6. DB 저장 성공/브로드캐스트 실패 불일치
7. 멀티 인스턴스에서 일부 사용자만 메시지 수신
8. 재접속 시 메시지 유실
9. 중복 메시지 전송
10. 읽음/안읽음 수 불일치

---

# 네가 백엔드에서 반드시 정리해야 할 예외 처리 기준

채팅 서비스 설계할 때 아래 기준을 미리 정해야 한다.

## A. 연결 기준

- 연결 실패 시 어떤 코드/메시지를 줄지
- heartbeat 주기
- idle timeout
- 재접속 정책

## B. 권한 기준

- connect / subscribe / send 각각 어디서 검증할지
- 방 접근 권한 없는 경우 처리 방식

## C. 메시지 기준

- 최대 길이
- 허용 타입(text, image, system, file)
- 빈 문자열 허용 여부
- 금지어/스팸 정책

## D. 정합성 기준

- 순서 보장 필요 수준
- 중복 허용 여부
- 저장 실패 시 보상 정책
- 읽음 처리 갱신 규칙

## E. 확장 기준

- 단일 인스턴스인지 멀티 인스턴스인지
- Redis pub/sub, broker 사용 여부
- presence 저장 위치
- reconnect 후 missed sync 방식

---

# Spring WebSocket/STOMP 기준으로 보면 실제 예외 클래스/상황 예시

대표적으로는 이런 것들까지 연결된다.

- `HandshakeFailureException`
- `IllegalArgumentException`
- `AccessDeniedException`
- `MessageConversionException`
- `MethodArgumentNotValidException`
- `ConstraintViolationException`
- `RedisConnectionFailureException`
- `DataAccessException`
- `SocketTimeoutException`
- `IOException`
- `OptimisticLockingFailureException`
- `RejectedExecutionException`

근데 중요한 건 **예외 클래스 이름 자체보다, 어떤 상황에서 사용자 경험이 깨지는지**를 기준으로 분류하는 거다.

---

# 추천하는 예외 분류 체계

실제로는 이렇게 묶으면 제일 관리하기 쉽다.

## 1. CONNECT_ERROR

- handshake 실패
- 인증 실패
- 타임아웃

## 2. SUBSCRIBE_ERROR

- 방 없음
- 권한 없음
- 중복 구독

## 3. MESSAGE_VALIDATION_ERROR

- 형식 오류
- 필드 누락
- 크기 초과
- 빈 메시지

## 4. MESSAGE_PROCESSING_ERROR

- 저장 실패
- 브로드캐스트 실패
- 외부 시스템 장애

## 5. PRESENCE_ERROR

- 입퇴장 정합성 오류
- 온라인 상태 불일치

## 6. DELIVERY_ERROR

- 중복
- 유실
- 순서 역전
- 재전송 실패

## 7. SYSTEM_ERROR

- Redis 장애
- DB 장애
- 서버 과부하
- 스레드풀 거절

---
