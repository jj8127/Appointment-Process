# 추천인 시스템 스펙

- 기준일: `2026-04-01`
- 상태: `추천코드 운영/가입 확정/동명이인 안전화는 구현됨, 앱 미설치 복원과 일부 runtime 재검증은 미완료`
- 범위: `가람in` 가입/초대 흐름

## 1. 목표

- A의 권유 또는 공유로 B가 가입했는지 신뢰 가능한 방식으로 남긴다.
- 플레이스토어 검색 설치처럼 초대링크만으로 끊기는 경로를 `추천코드 fallback`으로 보완한다.
- 장애가 나더라도 어떤 단계에서 추천 정보가 유실됐는지 추적 가능해야 한다.

## 2. 핵심 결정

### 2.1 기본 방식

- `자동 입력 추천코드 + 수동 수정 fallback`을 기본 구조로 채택한다.
- 초대링크 유입 정보가 있으면 회원가입 화면에 추천코드를 자동 입력한다.
- 자동 입력은 기본값일 뿐이며, 가입 완료 전에는 사용자가 다른 유효 코드로 수정할 수 있다.
- 현재 앱 UI는 `추천인 이름`이 아니라 `추천 코드 (선택)` 입력을 사용한다.
- 추천코드는 입력 시 즉시 대문자로 정규화하고, `validate-referral-code` trusted path로 inviter 정보를 검증한다.
- `validate-referral-code`는 `inviterName`, `inviterPhoneMasked`, `inviterFcId`, `codeId`를 반환한다.
- 최종 가입 시 서버는 caller가 보낸 추천인 문자열을 신뢰하지 않고, 추천코드 row를 다시 조회해 구조화 inviter identity를 확정한다.

### 2.2 확정 시점

- 추천 관계의 1차 확정 시점은 `회원가입 완료`다.
- 가람in 온보딩 전체 완료와 추천 확정을 묶지 않는다.
- 가입 전 `pending attribution` 서버 row는 현재 구현하지 않았다. 앱은 로컬 pending code만 유지한다.
- `set-password` Edge Function이 `referralCode`를 받아 가입 완료 직후 best-effort로 confirmed attribution과 이벤트를 기록한다.
- `set-password`는 유효한 추천코드가 해석된 경우에만 `fc_profiles.recommender_fc_id`와 `fc_profiles.recommender`를 저장한다.
- 현재 `set-password`가 남기는 attribution의 `source/capture_source/selection_source`는 deep link 여부와 무관하게 `manual_entry/manual_entry/manual_entry_only`로 정규화된다. 링크 provenance를 DB source에서 복원하는 계약은 아직 없다.

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
- `public.get_invitee_referral_code(uuid)`의 intended repo contract는 migration `20260401000001_fix_referral_code_fn_anon_grant.sql` 이후 `service_role` execute only 다. 원격 DB가 모두 그 상태인지 확인하지 않았다면 rollout 미검증 상태로 기록하고, 예외 상태를 의도 계약처럼 문서화하지 않는다.
- FC 삭제/재가입 정리 후에도 추천 attribution/event 감사 흔적은 남아야 한다.
- 구조화 추천인 식별자의 SSOT는 `referral_code`, `inviter_fc_id`, `fc_profiles.recommender_fc_id`다. `fc_profiles.recommender`는 표시 cache로만 유지한다.

## 3. 용어

- `inviter`: 추천한 사람(A)
- `invitee`: 추천받아 가입한 사람(B)
- `referral_code`: 추천인 식별 코드
- `invite_link`: 추천코드를 포함한 공유 URL
- `pending attribution`: 아직 가입 완료 전인 추천 추적 상태
- `confirmed referral`: 가입 완료 후 확정된 추천 관계
- `override`: 가입 완료 후 운영자가 예외적으로 추천 관계를 수정하는 행위
- `direct client access`: 앱/웹 클라이언트가 추천인 테이블을 직접 조회/쓰기하는 방식
- `trusted server path`: Edge Function 또는 service-role route가 추천인 테이블을 읽고 쓰는 경로

## 4. 사용자 흐름

### 4.1 자동 입력 추천코드

1. B가 초대링크 또는 유입 정보를 가진 상태로 회원가입 흐름에 진입한다.
2. 회원가입 화면에 추천코드가 자동 입력된다.
3. 사용자는 가입 완료 전까지 코드를 유지하거나 다른 유효 코드로 수정할 수 있다.
4. 현재 구현은 pending attribution row를 서버에 저장하지 않고 앱 로컬 pending code만 유지한다.
5. 가입 완료 시 `set-password` trusted path가 추천 관계를 1건 확정한다.

### 4.2 초대링크

1. A가 본인 링크를 공유한다.
2. B가 링크를 클릭한다.
3. 앱이 이미 설치된 경우 `hanwhafcpass://signup?code=<referral_code>`로 앱이 열린다.
4. `app/_layout.tsx`가 추천코드를 로컬 pending storage에 저장한다.
5. 회원가입 화면이 pending code를 1회 소비해 자동 입력한다.
6. 가입 완료 시 `set-password`가 추천 관계를 확정한다.

- 현재 앱 deep link 계약은 `hanwhafcpass://signup?code=<referral_code>`다.
- cold start에서는 pending code만 저장하고, warm start에서만 `/signup` 이동을 추가로 수행한다.
- landing click 로그, store redirect persistence, install referrer/deferred deep link 복원은 포함되지 않는다.

### 4.3 앱 미설치/스토어 진입 경로의 현재 상태

1. 초대링크 클릭 후 앱이 바로 열리지 않는 경로는 아직 자동 복원 계약이 없다.
2. 앱 설치 후 첫 실행에서 추천 정보가 자동 복원된다고 가정하지 않는다.
3. 현재 운영 fallback은 회원가입 화면에서 추천코드를 수동 입력하는 방식이다.

### 4.4 링크 유실 fallback

1. B가 링크를 눌렀지만 스토어 검색/설치 후 추천 정보가 복원되지 않는다.
2. 회원가입 화면에서 추천코드를 수동 입력한다.
3. 가입 완료 시 수동 코드 기준으로 확정한다.

### 4.5 FC 본인 추천코드 self-service 조회

1. 현재 앱 hook `useMyReferralCode()`는 `get-my-referral-code` Edge Function을 호출한다.
2. active self-service 조회는 `Authorization: Bearer <appSessionToken>` 기반으로 세션의 `phone` / `fcId`만 사용해 대상 FC를 해석한다.
3. `get-fc-referral-code`는 legacy compatibility alias로 저장소에 남아 있어도 `2026-04-02` 기준 current app hook path는 아니다. 이 함수의 optional `phone` body는 세션 전화번호와 일치할 때만 허용된다.

## 5. 식별자 규칙

### 5.1 추천코드

- 형식: `8자리` 영문 대문자+숫자
- 혼동 문자(`O`, `0`, `I`, `1`)는 제외
- 정책: `사용자당 1개 활성 코드`
- 실제 문자집합: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- 코드 생성 충돌 시 최대 10회까지 재시도하고, 초과 시 발급을 중단한다.

### 5.2 초대링크

- 권장 형태:
  - `https://<landing-domain>/invite/<referral_code>`
  - 또는 `https://<landing-domain>/invite?code=<referral_code>`
- 현재 앱 런타임이 실제로 읽는 값은 deep link query `code`다.

## 6. 상태 모델

- `captured`
- `pending_signup`
- `confirmed`
- `rejected`
- `cancelled`
- `overridden`

현재 repo는 위 상태 집합을 모두 스키마 차원에서 허용하지만, live 가입 경로는 별도 server-side pending row 없이 `confirmed/rejected/overridden` 중심으로 사용한다.

## 7. 데이터 모델

### 7.1 추천코드 마스터

- 목적: 사용자와 코드의 현재 활성 관계 보관
- direct DB select/write는 운영/admin과 trusted server path에만 허용한다.

예시 필드:
- `fc_id`
- `code`
- `is_active`
- `created_at`
- `disabled_at`

### 7.2 추천 추적/확정

- 목적: 가입 완료 시 추천 관계를 구조화해 보관

예시 필드:
- `inviter_fc_id`
- `inviter_phone`
- `inviter_name`
- `invitee_fc_id`
- `invitee_phone`
- `referral_code_id`
- `referral_code`
- `source`
- `capture_source`
- `selection_source`
- `status`
- `captured_at`
- `confirmed_at`

- `inviter_fc_id`는 FK 참조용이고 삭제 후 이력 보존을 위해 nullable로 유지한다.
- inviter 식별의 감사 흔적은 `inviter_phone`, `inviter_name` snapshot으로 남긴다.

### 7.3 이벤트 로그

- 목적: 장애 추적과 관찰성

현재 repo가 허용하는 주요 event_type:
- `signup_completed`
- `referral_confirmed`
- `referral_rejected`
- `code_generated`
- `code_rotated`
- `code_disabled`
- `admin_override_applied`

- `link_clicked`, `app_opened_from_link`, `pending_attribution_saved` 같은 단계형 이벤트는 현재 persisted runtime contract가 아니다.

### 7.4 관리자 감사 로그

- 1차 스키마에서는 별도 감사 테이블을 두지 않고 `referral_events.admin_override_applied` + `metadata`로 기록한다.
- 운영 감사 요구가 커지면 dedicated audit table을 후속 추가한다.

### 7.5 기존 `fc_profiles.recommender`와의 관계

- 구조화 추천 관계의 SSOT는 `referral_codes`, `referral_attributions`, `referral_events`, `fc_profiles.recommender_fc_id`다.
- `fc_profiles.recommender_fc_id`는 관리자 화면과 invitee 조회 경로가 쓰는 구조화 링크다.
- `fc_profiles.recommender`는 과도기 호환용 표시 cache이며, 추천 관계 판단에는 사용하지 않는다.
- 관리자 수동 보정도 자유 입력 문자열이 아니라 `활성 추천코드 보유 FC` 검색/선택으로만 허용한다.
- 레거시 `recommender` 문자열만 있는 FC도 관리자 화면에서 clear 또는 구조화 override 대상으로 다뤄야 한다.
- invitee 화면의 `가입 시 사용한 추천코드` 표시값을 계산하는 함수 `get_invitee_referral_code(uuid)`는 아래 우선순위만 사용한다.
  1. `fc_profiles.recommender_fc_id`의 현재 활성 `referral_codes`
  2. 최신 `confirmed referral_attributions`의 `referral_code_id`에 연결된 코드 row
  3. 최신 `confirmed referral_attributions`의 `inviter_fc_id` 현재 활성 코드
  4. 최신 `confirmed referral_attributions.referral_code` snapshot
- repo source 기준 direct execute grant는 migration `20260401000001_fix_referral_code_fn_anon_grant.sql` 이후 `service_role` only 다.
- 웹 추천인 override/legacy link 경로는 DB migration `20260331000005_admin_apply_recommender_override.sql` 원격 적용 전 배포 금지다.

## 8. 예외 규칙

- `무효 코드`: 검증 실패, 추천 확정 금지
- `만료/비활성 코드`: 확정 금지, 수동 재입력 허용
- `자기추천`: 차단
- `이미 확정된 추천 관계`: 일반 사용자 재확정 금지, 관리자 override만 허용
- `가입 중 이탈`: 현재 구현의 복원은 server-side pending attribution이 아니라 local pending referral code 유지에 한정된다
- `링크 변조`: 코드 검증 실패로 처리하고 정상 가입은 막지 않되 추천 확정은 금지
- `추천인 삭제`: 기존 attribution/event는 삭제하지 않고 FK만 nullable 처리한 뒤 snapshot으로 복원 가능해야 한다

## 9. 운영/CS 규칙

- 운영자가 볼 수 있어야 하는 최소 항목:
  - 추천인 이름 cache 또는 구조화 링크 상태
  - invitee 화면의 `가입 시 사용한 추천코드` 표시값(없으면 `-`)
  - invitee와 inviter의 식별 정보
  - 코드 운영 이벤트 및 override 감사 metadata
- 현재 `/dashboard/referrals`는 `추천코드 운영 화면`이다.
  - FC별 현재 활성 코드
  - 비활성 코드 이력
  - 코드 lifecycle + `admin_override_applied` 최근 이벤트
  - 레거시 추천인 검토 큐
- `/dashboard/referrals`를 full `referral_attributions` 탐색기처럼 문서화하지 않는다.
- `backfill_missing_codes`는 수동 실행형 idempotent batch로만 운영하고, 1회 호출당 최대 100명만 처리한다.
- 오늘 백필 대상은 `signup_completed=true`, `phone=11자리`, `affiliation`이 `설계매니저` 패턴이 아니고, `admin_accounts`/`manager_accounts` 전화번호와 겹치지 않으며, 활성 추천코드가 없는 `fc_profiles`만이다.
- 조회 권한은 `admin`/`developer`/`manager` 모두 허용하되, mutate(`일괄 발급`, `재발급`, `비활성`, `legacy link`)는 `admin` role만 허용한다.
- `developer` subtype은 mutate 시 감사 metadata에 `actorStaffType=developer`로 남기고, `manager`는 UI read-only와 서버 `POST 403`을 동시에 만족해야 한다.
- 관리자 override/cancel/clear는 모두 `reason` 입력이 필수이며, `referral_events.admin_override_applied.metadata`에 `actorPhone`, `actorRole`, `actorStaffType`, `beforeRecommenderName`, `beforeRecommenderFcId`, `afterRecommenderName`, `afterRecommenderFcId`, `reason`이 남아야 한다.

## 10. 미확정 항목

1. 추천 보상 지급 여부와 지급 트리거
2. 추천코드 중복 재발급 허용 정책
3. 가입 완료 전 코드 수정 UI를 자유 입력으로 둘지 검색/검증형으로 둘지
4. 동일 휴대폰 재가입 시 추천 관계 재사용 정책
5. install referrer를 Android에서 어디까지 쓸지
6. iOS deferred deep link 복원 전략
7. 관리자 override 권한을 `admin` 전체에 줄지 일부 운영자에만 줄지
8. 원격 DB rollout이 늦어진 환경을 어떻게 감시할지

미확정 항목을 코드에서 임의로 결정하지 말고, 결정 후 이 문서를 먼저 갱신한다.
