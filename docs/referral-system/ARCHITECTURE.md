# 추천인 시스템 아키텍처 초안

- 기준일: `2026-03-19`
- 상태: `Planning baseline`

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

### 2.1 추천코드 수동 입력

```text
회원가입 화면
  -> 추천코드 입력
  -> 서버 검증
  -> pending attribution 저장
  -> 가입 완료
  -> confirmed referral 확정
```

### 2.2 초대링크, 앱 이미 설치됨

```text
초대링크 클릭
  -> 앱 deep link 진입
  -> 앱이 추천코드/세션 저장
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
- 회원가입 화면 추천코드 UI
- 가입 완료 시 referral payload 전송

### 3.2 Backend / Edge Function Layer

- 코드 검증 API
- pending attribution 저장 API
- 가입 완료 확정 API
- 관리자 override API
- 이벤트 로깅/조회 API

### 3.3 Data Layer

- 추천코드 마스터
- 추천 추적/확정
- 이벤트 로그
- 감사 로그

## 4. 상태 보존 전략

추천 정보는 한 군데만 저장하면 유실되기 쉽다. 최소 2단계 보존을 권장한다.

1. 앱 로컬 pending state
   - 딥링크 직후 UI 복원용
2. 서버 pending attribution
   - 앱 삭제/재설치, 세션 단절, 운영 추적용

운영 관점에서는 서버에 pending 상태가 남아야 “왜 자동 추천이 안 붙었는지”를 추적할 수 있다.

## 5. 관찰성 이벤트

최소 아래 이벤트는 남겨야 한다.

- `link_clicked`
- `link_landing_opened`
- `app_opened_from_link`
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
- `source`
- `error_code`

## 6. 장애 추적을 위한 최소 로그 기준

- “링크를 눌렀는데 추천이 안 붙었다”를 재현하려면, `click -> app open -> pending save -> signup confirm` 중 어느 단계가 빠졌는지 보여야 한다.
- 따라서 추천인 시스템은 단순 성공/실패 로그가 아니라 단계형 이벤트 로그를 남겨야 한다.
- 운영 화면 또는 SQL로 추천 관계 타임라인을 복원할 수 있어야 한다.

## 7. 구현 순서 권장안

### Phase 0. 문서/케이스

- 이 폴더 문서 세트 확정
- 케이스 ID와 incident 기록 방식 확정

### Phase 1. 추천코드 MVP

- 추천코드 생성/검증
- 회원가입 수동 입력
- confirmed 저장
- 관리자 조회

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

## 8. request_board 연동 원칙

- V1에서는 `request_board`가 추천 관계를 생성하지 않는다.
- `request_board`에서 추천인 정보를 보여줘야 한다면 읽기 전용 계약만 추가한다.
- 추천인 관계를 `request_board` DB에 중복 저장하지 않는다.
- 연동이 필요해지면 `request_board/docs/referral-integration.md`와 이 문서를 동시에 갱신한다.
