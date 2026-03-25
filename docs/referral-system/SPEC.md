# 추천인 시스템 스펙 초안

- 기준일: `2026-03-19`
- 상태: `Draft for phased implementation`
- 범위: 가람in 가입/초대 흐름

## 1. 목표

- A의 권유 또는 공유로 B가 가입했는지 신뢰 가능한 방식으로 남긴다.
- 플레이스토어 검색 설치처럼 초대링크만으로는 끊기는 경로를 `추천코드 fallback`으로 보완한다.
- 나중에 장애가 나더라도 어떤 상태에서 추천 관계가 유실됐는지 추적 가능해야 한다.

## 2. 핵심 결정

### 2.1 기본 방식

- `자동 입력 추천코드 + 수동 수정 fallback`을 기본 구조로 채택한다.
- 초대링크나 유입 정보가 있으면 회원가입 화면에 추천코드를 자동 입력한다.
- 자동 입력은 기본값일 뿐이며, 가입 완료 전에는 사용자가 다른 유효 코드로 수정할 수 있다.
- 자동 입력이 실패하거나 유입 정보가 없으면 추천코드를 수동 입력할 수 있다.

### 2.2 확정 시점

- 추천 관계의 1차 확정 시점은 `회원가입 완료`다.
- 가람in 온보딩 전체 완료와 추천 확정을 묶지 않는다.
- 향후 보상/정산이 생기면 `reward_eligible` 같은 별도 상태를 추가한다.
- 가입 전 `captured/pending_signup` 저장은 클라이언트 직접 DB 쓰기가 아니라 trusted server path에서만 처리한다.

### 2.3 우선순위

- 자동 입력된 추천코드는 회원가입 화면의 기본값으로만 사용한다.
- 자동 입력된 코드가 있고 사용자가 가입 완료 전에 다른 유효 코드를 직접 입력하면 `명시 입력한 추천코드`를 우선한다.
- 가입 완료 후에는 일반 사용자 경로로 추천인을 변경할 수 없고, 운영 수정이 필요하면 `admin override`로만 처리한다.

### 2.4 불변 규칙

- 한 추천인(`inviter`)은 여러 명의 가입자를 추천할 수 있다.
- 한 가입자(`invitee`)는 최종적으로 추천인 1명만 가진다.
- 자기 자신 추천 금지
- 이미 확정된 추천 관계의 무단 덮어쓰기 금지
- 추천 관계 변경은 관리자 감사 로그 없이는 허용하지 않음
- 추천코드만 저장하고 추천인 사용자 정보가 없는 고아 상태 금지
- 추천인 테이블(`referral_codes`, `referral_attributions`, `referral_events`)은 direct client access를 허용하지 않고 trusted server path로만 다룬다.
- FC 삭제/재가입 정리 후에도 추천 attribution/event 감사 흔적은 남아야 한다.

## 3. 용어

- `inviter`: 추천한 사람(A)
- `invitee`: 추천받아 가입한 사람(B)
- `referral_code`: 추천인 식별 코드
- `invite_link`: 추천코드를 포함한 공유 URL
- `pending attribution`: 아직 가입 완료 전인 추천 추적 상태
- `confirmed referral`: 가입 완료 후 확정된 추천 관계
- `override`: 가입 완료 후 운영자가 예외적으로 추천 관계를 수정하는 행위
- `direct client access`: 앱/웹 클라이언트가 추천인 테이블을 직접 조회/쓰기하는 방식. V1에서는 금지한다.
- `trusted server path`: Edge Function 또는 service-role을 사용해 추천인 테이블을 읽고 쓰는 경로

## 4. 사용자 흐름

### 4.1 자동 입력 추천코드

1. B가 초대링크 또는 유입 정보를 가진 상태로 회원가입 흐름에 진입
2. 회원가입 화면에 추천코드가 자동 입력된다
3. 사용자는 가입 완료 전까지 코드를 유지하거나 다른 유효 코드로 수정할 수 있다
4. trusted server path가 최종 선택된 코드를 검증하고 pending attribution을 저장한다
5. 가입 완료 시 trusted server path가 추천 관계를 1건 확정한다

### 4.2 초대링크

1. A가 본인 링크 공유
2. B가 링크 클릭
3. 앱 설치 여부에 따라 앱 열기 또는 스토어 이동
4. 앱이 링크의 추천 정보를 임시 저장
5. 가입 완료 시 추천 관계 확정

### 4.3 링크 유실 fallback

1. B가 링크를 눌렀지만 스토어 검색/설치 후 추천 정보가 복원되지 않음
2. 회원가입 화면에서 추천코드 수동 입력
3. 가입 완료 시 수동 코드 기준 확정

## 5. 권장 식별자 규칙

### 5.1 추천코드

- 권장 형식: `8자리` 영문 대문자+숫자
- 혼동 문자(`O`, `0`, `I`, `1`)는 가능하면 제외
- 기본 정책은 `사용자당 1개 활성 코드`
- 2026-03-25 운영 기준 실제 코드 형식은 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` 문자집합의 8자리 고정이다.
- 코드 생성 충돌 시 최대 10회까지 재시도하고, 초과 시 발급을 중단한다.

### 5.2 초대링크

- 권장 형태:
  - `https://<landing-domain>/invite/<referral_code>`
  - 또는 `https://<landing-domain>/invite?code=<referral_code>`
- 앱 스킴/유니버설 링크/앱링크는 같은 추천코드를 전달해야 한다.

## 6. 상태 모델

추천인 추적 상태는 최소 아래를 권장한다.

- `captured`
- `pending_signup`
- `confirmed`
- `rejected`
- `cancelled`
- `overridden`

## 7. 권장 데이터 모델

구현 전 단계 기준 권장 엔터티는 아래와 같다.

### 7.1 추천코드 마스터

- 목적: 사용자와 코드의 현재 활성 관계 보관
- 직접 DB select/write는 운영/admin과 trusted server path에만 허용한다.
- 예시 필드:
  - `user_id`
  - `referral_code`
  - `is_active`
  - `created_at`
  - `disabled_at`

### 7.2 추천 추적/확정

- 목적: 링크 클릭, 코드 입력, 가입 확정까지 한 줄기로 추적
- 예시 필드:
  - `inviter_fc_id`
  - `inviter_phone`
  - `inviter_name`
  - `invitee_fc_id`
  - `referral_code`
  - `source`
    - `auto_prefill`
    - `manual_entry`
    - `admin_override`
  - `capture_source`
    - `invite_link`
    - `manual_entry`
    - `unknown`
  - `selection_source`
    - `auto_prefill_kept`
    - `auto_prefill_edited`
    - `manual_entry_only`
    - `admin_override`
  - `status`
  - `landing_session_id`
  - `device_hint`
  - `captured_at`
  - `confirmed_at`
- `inviter_fc_id`는 FK 참조용이고 삭제 후 이력 보존을 위해 nullable로 유지한다.
- inviter 식별의 감사 흔적은 `inviter_phone`, `inviter_name` snapshot으로 남긴다.
- `invitee_phone`, `inviter_phone`은 정규화된 숫자 11자리 기준으로 저장한다.

### 7.3 이벤트 로그

- 목적: 장애 추적과 관찰성
- 예시 필드:
  - `event_type`
  - `referral_code`
  - `referral_code_id`
  - `inviter_phone`
  - `inviter_name`
  - `subject_user_id`
  - `metadata`
  - `created_at`
- 이벤트 로그는 FK가 끊겨도 사건 당시 추천코드/추천인을 복원할 수 있도록 snapshot 텍스트를 함께 저장한다.

### 7.4 관리자 감사 로그

- 목적: 수동 수정 추적
- 예시 필드:
  - `actor_user_id`
  - `target_user_id`
  - `before_value`
  - `after_value`
  - `reason`
  - `created_at`
- 1차 스키마 초안에서는 별도 감사 테이블을 만들지 않고 `referral_events`의 `admin_override_applied` + `metadata`로 기록한다.
- 운영 감사 요구가 커지면 dedicated audit table을 후속 추가한다.

## 7.5 기존 `fc_profiles.recommender`와의 관계

- 현재 앱 회원가입/기본정보 화면은 여전히 `fc_profiles.recommender` 자유입력 문자열을 사용 중이다.
- 추천인 시스템 도입 이후의 구조화된 SSOT는 `referral_codes`, `referral_attributions`, `referral_events`다.
- `fc_profiles.recommender`는 과도기 호환용 레거시 입력/표시 필드로 간주한다.
- 신규 구현은 추천 관계 판단을 `fc_profiles.recommender` 문자열에 의존하지 않는다.
- 2026-03-25 기준 오늘 구현 범위는 추천 관계 확정이 아니라 운영용 추천코드 마스터다. 따라서 가입 화면과 `set-password` 경로의 `recommender` 사용은 그대로 유지한다.
- 실제 전환 시점에는 다음 중 하나를 별도 결정해야 한다.
  1. UI를 구조화 추천코드 기반으로 완전히 교체
  2. `recommender`를 표시용 cache로만 유지
  3. `recommender`를 제거하고 migration/backfill 수행

## 8. 예외 규칙

- `무효 코드`: 가입 제출 차단 또는 저장 차단, 로그는 남김
- `만료/비활성 코드`: 확정 금지, 수동 재입력 허용
- `자기추천`: 차단
- `이미 확정된 추천 관계`: 일반 사용자 재확정 금지, 관리자 override만 허용
- `가입 중 이탈`: pending attribution 유지 여부를 명시적으로 관리
- `링크 변조`: 코드 검증 실패로 처리하고 정상 가입은 막지 않되 추천 확정은 금지
- `추천인 삭제`: 기존 attribution/event는 삭제하지 않고 FK만 nullable 처리한 뒤 snapshot으로 복원 가능해야 한다

## 9. 운영/CS 규칙

- 운영 화면에서는 최소 아래가 보여야 한다.
  - 추천인
  - 피추천인
  - source
  - capture_source / selection_source
  - status
  - captured/confirmed timestamp
  - 최근 이벤트 타임라인
  - inviter FK 존재 여부와 snapshot(phone/name) 보존 여부
- 운영자가 추천 관계를 수정할 수 있다면 reason 입력과 감사 로그는 필수다.
- 2026-03-25 기준 1차 운영 구현 범위는 `추천인 코드 마스터 운영`이다. 즉, 관리자 웹은 FC별 현재 활성 코드, 비활성 코드 이력, 최근 코드 운영 이벤트를 조회할 수 있어야 한다.
- `backfill_missing_codes`는 수동 실행형 idempotent batch로만 운영하고, 1회 호출당 최대 100명만 처리한다.
- 오늘 백필 대상은 `signup_completed=true`, `phone=11자리`, `affiliation`이 `설계매니저` 패턴이 아니고, `admin_accounts`/`manager_accounts` 전화번호와 겹치지 않으며, 활성 추천코드가 없는 `fc_profiles`만이다.
- 조회 권한은 `admin`/`developer`/`manager` 모두 허용하되, mutate(`일괄 발급`, `재발급`, `비활성`)는 `admin` role만 허용한다.
- `developer` subtype은 mutate 시 감사 metadata에 `actorStaffType=developer`로 남기고, `manager`는 UI read-only와 서버 `POST 403`을 동시에 만족해야 한다.

## 10. 미확정 항목

아래는 구현 시작 전에 확정이 필요하다.

1. 추천 보상 지급 여부와 지급 트리거
2. 추천코드 중복 재발급 허용 정책
3. 가입 완료 전 사용자 코드 수정 UI를 자유 입력으로 둘지 검색/검증형으로 둘지
4. 동일 휴대폰 재가입 시 추천 관계 재사용 정책
5. install referrer를 Android에서 어디까지 쓸지
6. iOS deferred deep link 복원 전략
7. 관리자 override 권한을 `admin` 전체에 줄지 일부 운영자에만 줄지
8. 향후 앱 인증 모델이 Supabase Auth 중심으로 정리되면 direct RLS read를 다시 열지 여부

미확정 항목을 코드에서 임의로 결정하지 말고, 결정 후 이 문서를 먼저 갱신한다.
