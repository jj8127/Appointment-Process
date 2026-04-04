# AGENTS.md

## 0. Control Tower Scope

- 이 폴더는 `가람in` 추천인 시스템의 전용 운영 문서 세트다.
- 저장소 전역 규칙은 루트 `AGENTS.md`를 따르고, 추천인 전용 규칙은 이 폴더 문서를 따른다.
- 추천코드, 초대링크, 딥링크, 추천 관계 확정, 운영 보정, 장애 이력, 테스트 자산을 이 폴더에서 관리한다.
- `request_board`는 추천인 데이터의 원천 소유자가 아니며, 연동 포인트만 별도 문서로 관리한다.

## 1. Session Start / Finish Protocol

### 1.1 시작 전

다음 순서로 읽는다.

1. 루트 `AGENTS.md`
2. `docs/referral-system/AGENTS.md`
3. `docs/referral-system/SPEC.md`
4. `docs/referral-system/TEST_CHECKLIST.md`
5. `docs/referral-system/INCIDENTS.md`
6. 필요 시 `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`의 관련 앵커

### 1.2 작업 종료 전

추천인 관련 변경이 있으면 아래를 같은 변경 세트로 묶는다.

1. 규칙/요구사항 변경: `AGENTS.md`, `SPEC.md`
2. 구조/흐름 변경: `ARCHITECTURE.md`
3. 테스트 추가/수정: `TEST_CHECKLIST.md`, `test-cases.json`, `TEST_RUN_RESULT.json`
4. 신규 장애/회귀: `INCIDENTS.md`
5. 테스트 데이터/운영 계정 변화: `fixtures/README.md`
6. 저장소 전역 진입점: 루트 `AGENTS.md`, `docs/README.md`, 필요 시 `README.md`
7. 작업 이력: `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`

## 2. Domain Boundary

### 2.1 In Scope

- 추천코드 발급/노출/검증
- 초대링크 생성/앱 진입
- 가입 도중 이탈/재진입 시 추천 정보 복원
- 추천 관계 확정/취소/운영 보정
- 추천 이벤트 로그와 관찰성
- 회귀 테스트와 장애 이력 누적

### 2.2 Out Of Scope By Default

- 추천 보상 정산 로직
- MLM/다단계형 업라인 수당 구조
- 광고 플랫폼 어트리뷰션 전체 통합
- request_board 내부 독립 추천 시스템

위 항목이 필요해지면 먼저 `SPEC.md`와 `ARCHITECTURE.md`를 갱신한 뒤 구현한다.

## 3. Documentation Rules

### 3.1 Single Source Of Truth

- 추천인 정책의 SSOT는 `SPEC.md`다.
- 추천인 테스트 케이스 ID의 SSOT는 `test-cases.json`이다.
- 추천인 실행 결과의 SSOT는 `TEST_RUN_RESULT.json`이다.
- 추천인 실제 장애와 해결 이력의 SSOT는 `INCIDENTS.md`다.

### 3.2 Required Update Rules

- 추천인 관련 UI 문구, 확정 시점, 우선순위, 예외 규칙이 바뀌면 `SPEC.md`를 무조건 갱신한다.
- 딥링크, pending 저장 방식, Supabase 테이블, Edge Function 책임이 바뀌면 `ARCHITECTURE.md`를 갱신한다.
- 버그를 고쳤는데 `INCIDENTS.md`와 회귀 케이스가 없으면 작업이 끝난 것으로 보지 않는다.
- 테스트 케이스를 추가했는데 `TEST_RUN_RESULT.json`에 결과 틀이 없으면 작업이 끝난 것으로 보지 않는다.
- 코드 변경 없이도 운영 규칙이 바뀌면 문서만 별도 갱신할 수 있다. 이 경우에도 작업 이력은 남긴다.
- 추천인 테이블의 직접 RLS 접근 정책이나 RPC execute grant가 바뀌면 `SPEC.md`, `ARCHITECTURE.md`, `contracts/database-schema.md`를 같은 변경 세트로 갱신한다.

## 4. Incident Protocol

추천인 관련 문제가 발생하면 `INCIDENTS.md`에 아래를 반드시 남긴다.

1. 증상
2. 영향 범위
3. 재현 절차
4. 실제 원인
5. 수정 내용
6. 추가한 회귀 케이스 ID
7. 검증 방법과 증적 위치

다음 형태의 기록은 금지한다.

- `재현 안 됨`
- `원인 불명`
- `일단 수정`

재현이 어려우면 왜 어려운지, 어떤 로그/가정을 근거로 추정했는지 적는다.

## 5. Test Execution Contract

### 5.1 기본 원칙

- 추천인 구현은 `추천코드`, `초대링크`, `fallback`, `운영 보정`, `보안`, `관찰성` 축을 모두 검증해야 한다.
- `P0` 케이스 하나라도 `FAIL`, `BLOCKED`면 기능 완료로 간주하지 않는다.
- 사람이 수동으로 검증했든 AI가 반자동으로 검증했든 결과는 `TEST_RUN_RESULT.json`에 남긴다.
- 실행 증적은 화면 캡처, 서버 로그, DB 검증 중 최소 2종을 남긴다.
- repo source만 보고 내린 계약 정리는 검증 완료로 기록하지 않는다. 그런 항목은 `NOT_RUN` 또는 `BLOCKED`로 남기고 notes에 이유를 적는다.

### 5.2 필수 결과 필드

- `status`: `NOT_RUN | PASS | FAIL | BLOCKED | SKIPPED`
- `executedAt`: ISO datetime
- `owner`: 실행 주체
- `evidence`: 파일/로그/명령
- `notes`: 실패 원인 또는 확인 내용

### 5.3 회귀 규칙

- 장애가 한 번이라도 발생하면 해당 시나리오는 반드시 고정 케이스로 승격한다.
- 같은 장애를 두 번 재현했다면, 사람 의존 체크리스트만 두지 말고 가능한 범위에서 자동 검증 절차를 추가한다.
- 자동화가 아직 불가능한 케이스도 `어떤 준비가 있어야 자동화되는지`를 notes에 남긴다.

## 6. Implementation Bar

- 추천인 코드는 입력만 되고 실제 관계가 저장되지 않는 상태로 배포하지 않는다.
- 초대링크는 앱 설치 상태 direct deep link prefill과 가입 확정이 이어지지 않으면 완료로 보지 않는다.
- fallback 규칙이 정의되지 않은 상태에서 추천코드와 링크를 함께 배포하지 않는다.
- 현재 앱 추천인 화면의 self-service 변경은 FC/본부장 세션에 한해 허용되며, 운영/admin bulk mutate 경로와 분리해 관리한다.
- 관리자 수동 보정 기능을 만들면 감사 로그 없이 배포하지 않는다.
- 추천인 테이블은 인증 모델이 정리되기 전까지 클라이언트가 직접 조회/쓰기하지 않는다. 모든 읽기/쓰기는 trusted Edge Function 또는 service-role 경로로 제한한다.
- `public.get_invitee_referral_code(uuid)`의 intended repo contract는 `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` execute only 다. 새 코드에서 direct RPC 호출을 추가하지 말고 `admin-action:getInviteeReferralCode` 또는 server-only route를 사용한다.
- 다만 이 문서는 source repo 기준 SSOT다. 원격 DB rollout이 실제로 끝났는지는 별도 검증 없이는 문서에서 완료라고 쓰지 않는다.
- 관리자/운영 문서에서 invitee 코드 표시는 `추천인 현재 활성 코드`가 아니라 `가입 시 사용한 추천코드` 의미로 적는다. server lookup이 active-code fallback을 포함하더라도 사용자 문구를 그 내부 우선순위로 바꿔 적지 않는다.
- `set-password`는 OTP trusted path가 이미 만든 `phone_verified=true` profile만 최종 가입으로 승격해야 한다. fresh-number direct call에서 신규 profile/credentials를 만들면 안 된다.
- `set-password`는 `fc_credentials.password_set_at`를 destructive profile reset보다 먼저 확인해야 한다. duplicate/direct call이 기존 추천인/온보딩 상태를 지우는 동작은 금지한다.
- FC 일반 사용자 기본정보 화면은 `fc_profiles.recommender` cache를 읽기 전용으로만 보여준다. 자유입력 저장 경로를 다시 열지 않는다.
- FC/본부장 본인 추천코드 self-service 조회의 현재 앱 런타임 경로는 `hooks/use-my-referral-code.ts -> get-my-referral-code`다. `get-fc-referral-code`가 저장소에 남아 있어도 current hook path처럼 문서화하지 않는다.
- 앱 미설치 후 스토어 설치/복원, landing click 로그, server-side pending attribution은 아직 live 계약이 아니다. 구현/검증이 끝나기 전에는 문서에서 이미 운영 중인 흐름처럼 서술하지 않는다.
- FC 삭제/재가입 정리 시에도 추천 attribution/event 히스토리는 남아야 한다. 삭제 편의 때문에 추천인 감사 흔적을 잃는 구조는 허용하지 않는다.
- 추천코드 운영 화면은 `manager` 읽기 전용 UI와 서버 `POST 403`을 동시에 만족해야 한다.
- 웹 추천인 override/legacy link UI는 DB migration `20260331000005_admin_apply_recommender_override.sql`이 원격 적용되기 전에는 배포하지 않는다.
- `/dashboard/referrals`는 현재 `추천코드 마스터 운영 + 레거시 추천인 검토 큐` 화면이다. full `referral_attributions` 탐색기처럼 문서화하지 않는다.
- 레거시 추천인 검토 큐는 `자동 연결 가능`, `동명이인 후보 다수`, `후보 없음`, `잘못된 자기추천` 상태를 명시적으로 보여줘야 한다.
- `안전 자동 정리` batch는 exact-unique(`자동 연결 가능`)만 처리하고, `잘못된 자기추천`/`후보 없음`/`동명이인 후보 다수`는 자동 정리 대상에 넣지 않는다.
- `/dashboard/referrals/graph`는 추천 관계를 읽기 전용으로 탐색하는 graph surface다. visible edge 기본 소스는 `fc_profiles.recommender_fc_id`이고, `confirmed referral_attributions`는 같은 관계 edge의 상태를 강화하는 보조 증거로만 합친다.
- `/dashboard/referrals/graph`는 graph 안에서 mutate CTA를 다시 열지 않는다. node drag, 빈 캔버스 pan, fit/reset, node label 가시성은 허용하되 manager는 계속 read-only다.

## 7. Current Delivery Plan

1. 문서/테스트 체계 확립
   - 이 폴더의 SSOT와 케이스 체계 확정
2. 추천코드 운영 기반
   - 기존 FC 추천코드 일괄 백필
   - 관리자/개발자 재발급, 비활성, 감사 metadata
   - 관리자/본부장 조회 화면과 read-only guard
3. 추천코드 MVP
   - 자동 입력 코드, 가입 전 수정 fallback, 가입 완료 시 trusted confirm, 추천 관계 확정
4. 초대링크
   - 현재 live 범위: 앱 설치 상태 direct deep link + 로컬 pending prefill
   - 후속 범위: 랜딩, 스토어 fallback persistence, 설치 후 자동 복원
5. 설치 후 복원
   - deferred deep link 또는 install referrer 계열 복원
6. 운영 도구
   - 추천 관계 조회, 보정, 로그, 감사
7. 회귀 자동화
   - 반복 장애를 스크립트/테스트 자산으로 승격

## 8. Context Map

- `[정책/상태/우선순위](./SPEC.md)` — 추천인 규칙을 수정할 때
- `[구현 구조/책임 경계](./ARCHITECTURE.md)` — 앱/서버/링크 흐름을 설계할 때
- `[실행 체크리스트](./TEST_CHECKLIST.md)` — 테스트 순서와 증적 기준을 확인할 때
- `[케이스 원본](./test-cases.json)` — 기계가 읽을 테스트 SSOT가 필요할 때
- `[실행 결과](./TEST_RUN_RESULT.json)` — 마지막 검증 상태를 확인할 때
- `[장애 이력](./INCIDENTS.md)` — 과거 문제와 회귀 케이스를 확인할 때
- `[테스트 데이터 규칙](./fixtures/README.md)` — 추천인 테스트 계정/초기화 기준을 확인할 때
- `[검증 SQL 초안](./queries.sql)` — DB 정합성을 직접 확인할 때
