# 추천인 시스템 아키텍처 초안

- 기준일: `2026-03-19`
- 상태: `Phased implementation baseline`

## 1. 소유권

### 1.1 fc-onboarding-app가 소유하는 것

- 추천코드 마스터
- 초대링크 랜딩과 가입 확정
- 앱 딥링크 처리
- 추천 관계/이벤트 로그
- 관리자 조회/보정

### 1.2 request_board가 소유하지 않는 것

- 추천 관계의 원본 저장
- 추천코드 생성/검증
- 초대링크 확정 로직

`request_board`는 향후 추천 정보를 읽거나 표시할 수는 있지만, 원본 상태는 `fc-onboarding-app`에서만 관리한다.

## 2. 추천 방식별 흐름

### 2.1 자동 입력 추천코드

```text
회원가입 화면
  -> 추천코드 자동 입력
  -> 가입 전 사용자 수정 가능
  -> 최종 선택 코드 서버 검증
  -> pending attribution 저장
  -> 가입 완료
  -> confirmed referral 확정
```

### 2.2 초대링크, 앱 이미 설치됨

```text
초대링크 클릭
  -> 앱 deep link 진입
  -> 앱이 추천코드/세션 저장
  -> 회원가입 화면에 추천코드 자동 입력
  -> 회원가입 시작
  -> 가입 완료
  -> confirmed referral 확정
```

### 2.3 초대링크, 앱 미설치

```text
초대링크 클릭
  -> 랜딩 페이지/서버가 클릭 로그 저장
  -> 플레이스토어 이동
  -> 앱 설치 후 첫 실행
  -> 저장된 추천 정보 복원 시도
  -> 회원가입 완료
  -> confirmed referral 확정
```

### 2.4 링크 복원 실패

```text
스토어 검색/설치 또는 링크 유실
  -> 자동 추천 정보 없음
  -> 사용자가 추천코드 수동 입력
  -> 가입 완료
  -> confirmed referral 확정
```

## 3. 권장 컴포넌트 분리

### 3.1 App Layer

- 딥링크 수신기
- pending attribution 로컬 저장
- 회원가입 화면 추천코드 자동 입력 + 가입 전 수정 UI
- 가입 완료 시 referral payload 전송

### 3.2 Backend / Edge Function Layer

- 최종 선택 코드 검증 API
- pending attribution 저장 API
- 가입 완료 확정 API
- 관리자 override API
- 이벤트 로깅/조회 API
- 관리자 웹 추천코드 운영 API (`GET/POST /api/admin/referrals`)
  - `GET`: 요약/목록/상세 조회
  - `POST`: 수동 backfill, 코드 재발급, 코드 비활성
  - 모든 쓰기는 service-role 서버 경로만 사용

### 3.3 Data Layer

- 추천코드 마스터
- 추천 추적/확정
- 이벤트 로그
- 감사 로그

## 4. 접근 모델

- 현재 가람in 앱 세션은 Supabase Auth uid 중심이 아니라 전화번호 기반 커스텀 세션으로 동작한다.
- 따라서 추천인 테이블은 V1에서 direct client RLS 접근을 열지 않는다.
- 앱/웹은 추천인 정보를 직접 `select/insert/update`하지 않고, referral 전용 Edge Function을 통해서만 읽고 쓴다.
- 추천인 RLS는 운영/admin 직접 조회만 허용하고, 실제 사용자 흐름은 service-role trusted server path가 담당한다.

## 5. 상태 보존 전략

추천 정보는 한 군데만 저장하면 유실되기 쉽다. 최소 2단계 보존을 권장한다.

1. 앱 로컬 pending state
   - 딥링크 직후 UI 복원용
2. 서버 pending attribution
   - 앱 삭제/재설치, 세션 단절, 운영 추적용

운영 관점에서는 서버에 pending 상태가 남아야 “왜 자동 추천이 안 붙었는지”를 추적할 수 있다.

## 6. pending/confirm 쓰기 경로

- `pending attribution` 생성/갱신은 `referral-upsert-pending` 같은 trusted Edge Function이 담당한다.
- 회원가입 완료 시점 확정은 `referral-confirm-signup` 같은 trusted Edge Function이 담당한다.
- 운영 조회/override는 별도 운영용 trusted API를 통해 수행한다.
- 클라이언트는 추천코드 값, landing session, 디바이스 힌트 같은 입력만 전달하고 최종 DB 쓰기는 서버가 수행한다.
- 2026-03-25 기준 운영용 추천코드 마스터는 Edge Function이 아니라 Next.js admin route handler + service-role RPC 경로로 먼저 구현한다.
- 이 단계에서 가입 흐름은 아직 `pending/confirm` API를 사용하지 않으며, `recommender` 레거시 입력 필드는 그대로 남는다.

## 7. 삭제 후 이력 보존

- `referral_attributions`는 inviter FK가 삭제돼도 row를 남긴다.
- inviter 식별은 `inviter_phone`, `inviter_name` snapshot으로 복원한다.
- `referral_events`도 `referral_code`, `inviter_phone`, `inviter_name` snapshot을 함께 저장해 FK 유실 후에도 사건 당시 맥락을 보존한다.
- 계정 삭제/재가입 정리 함수는 추천 attribution/event를 hard delete하지 않는다.

## 8. 관찰성 이벤트

최소 아래 이벤트는 남겨야 한다.

- `link_clicked`
- `link_landing_opened`
- `app_opened_from_link`
- `code_auto_prefilled`
- `code_edited_before_signup`
- `pending_attribution_saved`
- `code_entered`
- `code_validated`
- `signup_completed`
- `referral_confirmed`
- `referral_rejected`
- `admin_override_applied`

각 이벤트에는 가능하면 아래 컨텍스트를 포함한다.

- `referral_code`
- `landing_session_id`
- `device/platform`
- `user_id` 또는 `phone_hash`
- `inviter_phone` / `inviter_name` snapshot
- `source`
- `error_code`

## 9. 장애 추적을 위한 최소 로그 기준

- “링크를 눌렀는데 추천이 안 붙었다”를 재현하려면, `click -> app open -> pending save -> signup confirm` 중 어느 단계가 빠졌는지 보여야 한다.
- 따라서 추천인 시스템은 단순 성공/실패 로그가 아니라 단계형 이벤트 로그를 남겨야 한다.
- 운영 화면 또는 SQL로 추천 관계 타임라인을 복원할 수 있어야 한다.

## 10. 구현 순서 권장안

### Phase 0. 문서/케이스

- 이 폴더 문서 세트 확정
- 케이스 ID와 incident 기록 방식 확정

### Phase 1A. 추천코드 운영 기반

- 기존 FC 코드 마스터 backfill
- 관리자/개발자 재발급/비활성
- 본부장 조회 전용 화면
- 코드 운영 이벤트(`code_generated`, `code_rotated`, `code_disabled`)
- 감사 metadata(`actorPhone`, `actorRole`, `actorStaffType`, `reason`, `previousCode`, `nextCode`)

### Phase 1B. 추천코드 MVP

- 추천코드 생성/검증
- trusted code validation/pending API
- 회원가입 자동 입력 코드 UI
- 가입 전 수정 fallback
- confirmed 저장
- 추천 관계 관리자 조회

### Phase 2. 초대링크

- 공유 링크 생성
- 랜딩 로깅
- 앱 딥링크 수신
- pending attribution 저장

### Phase 3. 설치 후 복원

- Android install referrer 또는 deferred deep link 전략 적용
- 복원 실패 fallback 정리

### Phase 4. 운영 도구

- 검색/필터/보정
- 감사 로그
- 장애 리포트/대시보드

## 11. request_board 연동 원칙

- V1에서는 `request_board`가 추천 관계를 생성하지 않는다.
- `request_board`에서 추천인 정보를 보여줘야 한다면 읽기 전용 계약만 추가한다.
- 추천인 관계를 `request_board` DB에 중복 저장하지 않는다.
- 연동이 필요해지면 `request_board/docs/referral-integration.md`와 이 문서를 동시에 갱신한다.

## 12. 기존 자유입력 추천인 필드와의 공존

- 현재 회원가입은 `fc_profiles.recommender` 자유입력 문자열을 사용한다.
- 추천인 시스템 V1 스키마 초안에서는 이를 즉시 제거하지 않고, 구조화된 추천 관계는 별도 테이블로 분리한다.
- 즉:
  - 자유입력 문자열: 레거시 호환/과도기 입력
  - 구조화 추천 관계: 신규 SSOT
- 실제 구현 시 회원가입 화면이 구조화 추천코드로 전환되면 `recommender`와의 동기화 또는 제거 정책을 별도로 결정한다.
