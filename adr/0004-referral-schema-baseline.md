# ADR 0004: Referral Schema Baseline

## Status
Proposed

## Context

가람in 추천인 시스템은 기존 `fc_profiles.recommender` 자유입력 문자열만으로는 구조화된 추천 관계, 자동 입력 추천코드, 가입 전 수정 fallback, 가입 후 운영 보정을 안정적으로 처리할 수 없다.

추천인 시스템은 다음 요구를 만족해야 한다.

- 한 추천인(`inviter`)은 여러 가입자를 추천할 수 있다.
- 한 가입자(`invitee`)는 최종 추천인 1명만 가진다.
- 기본 방식은 회원가입 화면 추천코드 자동 입력이다.
- 가입 완료 전에는 사용자가 다른 유효 코드로 수정할 수 있다.
- 가입 완료 후 변경은 일반 사용자 경로가 아니라 운영자 override로만 허용한다.
- 링크 클릭, 자동 입력, 수정, 확정, override 같은 단계를 로그로 복원할 수 있어야 한다.

## Decision

추천인 스키마 초안으로 아래 3개 테이블을 도입한다.

1. `referral_codes`
- FC별 추천코드와 활성 상태를 관리한다.
- FC당 활성 코드 1개만 허용한다.
- direct client access는 허용하지 않고 trusted server path가 읽기/쓰기를 담당한다.

2. `referral_attributions`
- 추천 관계의 `captured -> pending_signup -> confirmed/rejected/cancelled/overridden` 상태를 저장한다.
- `invitee_phone`과 `invitee_fc_id`를 함께 두어 가입 전/후 모두 추적 가능하게 한다.
- phone/fc 기준 partial unique index로 invitee 최종 추천인 1명 규칙을 강제한다.
- inviter FK는 nullable로 두고 `inviter_phone`, `inviter_name` snapshot을 함께 저장해 계정 삭제 후에도 이력을 보존한다.

3. `referral_events`
- 추천 흐름의 단계형 이벤트와 `admin_override_applied` 이력을 저장한다.
- 1차 초안에서는 별도 admin audit table 대신 이벤트 로그의 metadata를 감사 흔적으로 사용한다.
- `referral_code`, `inviter_phone`, `inviter_name` snapshot을 함께 저장해 FK 유실 후에도 사건 당시 맥락을 복원할 수 있게 한다.

추가 원칙:

- 구조화 추천인 SSOT는 신규 테이블 3종으로 이동한다.
- 기존 `fc_profiles.recommender`는 과도기 호환용 레거시 필드로 유지한다.
- direct client access 대신 Edge Function/service-role 신뢰 경로를 통해 추천 관계를 조회/생성/확정한다.

## Consequences

### Pros

- 자유입력 문자열에서 벗어나 추천 관계를 정규화할 수 있다.
- 가입 전 pending과 가입 후 confirmed를 같은 모델로 추적할 수 있다.
- 자동 입력 코드와 가입 전 수동 수정 흐름을 모두 수용할 수 있다.
- 추천인 장애를 이벤트 타임라인으로 재현하기 쉬워진다.
- FC 삭제/재가입 정리 후에도 attribution/event 히스토리를 유지할 수 있다.

### Cons

- 기존 `recommender` 필드와 신규 구조가 한동안 병행되어 마이그레이션 관리가 필요하다.
- 1차 초안에서는 override 감사가 이벤트 metadata에 있어, 장기적으로는 dedicated audit table이 더 적합할 수 있다.
- 추천인 기능이 아직 앱/Edge Function에 연결되지 않았으므로 스키마만으로는 동작하지 않는다.
- direct client query를 열지 않았기 때문에 초반 구현은 referral 전용 API contract를 먼저 만들어야 한다.

## Alternatives Considered

1. `fc_profiles.recommender` 문자열만 유지
- 추천 관계 정합성, cardinality 제약, 자동 입력/수정 추적, 운영 override 감사에 불리해 제외했다.

2. `referral_attributions` 없이 `referral_codes` + `referral_events`만 사용
- 현재 최종 추천 관계를 빠르게 조회하고 제약을 강제하기 어렵다.

3. 처음부터 `referral_admin_actions` 별도 감사 테이블까지 함께 도입
- 가능하지만 현재 사용자 요청 범위는 `referral_codes`, `referral_attributions`, `referral_events` 초안이 우선이라 1차에서는 제외했다.
