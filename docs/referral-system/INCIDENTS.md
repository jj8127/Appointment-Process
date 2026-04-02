# 추천인 시스템 장애 기록

## 1. 목적

- 추천인 시스템에서 한 번이라도 발생한 문제를 재현 가능한 형태로 남긴다.
- 같은 문제가 다시 발생했을 때 AI가 이 파일과 연결된 테스트 케이스만으로 바로 재현/검증할 수 있어야 한다.

## 2. 현재 상태

- `2026-04-02` 기준 등록된 추천인 이슈는 `7건`이다.
- 런타임 버그뿐 아니라 trust boundary, rollout status, 문서/테스트 drift로 운영 판단을 오도한 경우도 장애성 이력으로 남긴다.

## 3. 작성 규칙

- 장애 1건당 `INC-XXX` 하나를 부여한다.
- 증상만 적지 말고, 어느 단계에서 추천 정보가 끊겼는지 명시한다.
- 반드시 `linkedCases`를 적고, 없으면 새 케이스를 만든다.
- “고쳤다”로 끝내지 말고 어떤 로그/쿼리/화면으로 검증했는지 남긴다.

## 4. 템플릿

```markdown
## INC-001 | YYYY-MM-DD | 짧은 제목

- symptom:
- impact:
- trigger:
- rootCause:
- fix:
- linkedCases:
  - RF-...
- evidence:
  - 로그 경로
  - 스크린샷 경로
  - 쿼리 결과
- reproduction:
  1.
  2.
  3.
- regressionCheck:
  - 어떤 케이스를 어떻게 다시 돌렸는지
- notes:
```

## 5. 인덱스

| ID | 날짜 | 제목 | linkedCases | 상태 |
| --- | --- | --- | --- | --- |
| INC-007 | 2026-04-02 | latest docs follow-up 이후에도 invitee 코드 문구와 source-baseline이 intermediate 상태로 남은 drift | `RF-ADMIN-01`, `RF-SELF-01`, `RF-SEC-02` | fixed |
| INC-006 | 2026-04-02 | FC self-service 추천코드 조회 경계를 session-derived path로 재정렬하고 legacy alias를 harden | `RF-SELF-01`, `RF-SEC-02` | fixed |
| INC-005 | 2026-04-01 | self-service 경로와 RPC grant 상태가 최신 worktree와 다시 어긋난 문서/로그 drift | `RF-SELF-01`, `RF-SEC-02` | fixed |
| INC-004 | 2026-04-01 | 문서/테스트 자산이 실제 추천인 rollout/trust boundary보다 앞서 나감 | `RF-LINK-02`, `RF-OBS-01`, `RF-SEC-02`, `RF-SELF-01` | fixed |
| INC-003 | 2026-03-31 | 동명이인 안전화 후 live hardening gap(`set-password` fallback, override migration, clear audit) | `RF-ADMIN-06`, `RF-SEC-02` | mitigated |
| INC-002 | 2026-03-31 | 동명이인 추천인 이름 매칭으로 잘못된 코드가 붙을 수 있던 구조 위험 | `RF-DATA-02`, `RF-ADMIN-06` | fixed |
| INC-001 | 2026-03-31 | Android 추천코드 입력 시 대문자가 중복 입력되던 문제 | `RF-CODE-07` | fixed |

## INC-005 | 2026-04-01 | self-service 경로와 RPC grant 상태가 최신 worktree와 다시 어긋난 문서/로그 drift

- symptom:
  - 추천인 문서, work log, test asset 일부가 현재 worktree 기준 active self-service path를 `get-fc-referral-code`로 적고 있었고, `get_invitee_referral_code(uuid)` execute grant도 여전히 `authenticated` 예외가 남아 있는 것처럼 서술하고 있었다.
- impact:
  - 리뷰어와 후속 에이전트가 현재 코드 기준 trust boundary와 배포 대상 함수를 잘못 이해할 수 있었다.
  - 특히 self-service 검증 대상을 잘못 잡거나, repo source가 이미 `service_role` only로 정리된 사실을 놓칠 수 있었다.
- trigger:
  - 2026-04-01 referral docs/governance 재검토에서 `hooks/use-my-referral-code.ts`, `supabase/functions/get-my-referral-code/index.ts`, `supabase/schema.sql`, `20260401000001_fix_referral_code_fn_anon_grant.sql`를 다시 대조했을 때.
- rootCause:
  - 이전 문서 정리가 후속 worktree 변경을 따라가지 못했다.
  - self-service hook path와 repo-side grant hardening 상태가 `.claude` 로그와 referral SSOT 전체에 다시 반영되지 않았다.
- fix:
  - `docs/referral-system/*`, `.claude/PROJECT_GUIDE.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`, 필요 최소 범위의 루트 `AGENTS.md`를 현재 worktree 기준으로 재정렬했다.
  - self-service current path를 `hooks/use-my-referral-code.ts -> get-my-referral-code`로 정정했다.
  - `get_invitee_referral_code(uuid)`는 repo source 기준 `service_role` only intended contract로 정리하고, remote rollout은 별도 검증 없이는 완료라고 쓰지 않도록 바꿨다.
- linkedCases:
  - RF-SELF-01
  - RF-SEC-02
- evidence:
  - 코드 검토: `hooks/use-my-referral-code.ts`
  - 코드 검토: `supabase/functions/get-my-referral-code/index.ts`
  - schema/migration 검토: `supabase/schema.sql`, `supabase/migrations/20260401000001_fix_referral_code_fn_anon_grant.sql`
  - 문서 갱신: `docs/referral-system/*`, `.claude/PROJECT_GUIDE.md`
- reproduction:
  1. 기존 referral 문서와 `.claude` 가이드에서 self-service path와 RPC grant 설명을 읽는다.
  2. 실제 worktree의 `hooks/use-my-referral-code.ts`와 `schema.sql`/migration chain을 확인한다.
  3. 문서가 현재 구현보다 뒤처진 지점을 확인한다.
- regressionCheck:
  - RF-SELF-01로 active hook/function 경로를 별도 추적한다.
  - RF-SEC-02는 repo source intended contract와 remote rollout 검증 결과를 분리해 기록한다.
- notes:
  - 이번 항목은 새 runtime 버그가 아니라 docs/governance drift에 대한 장애성 기록이다.
  - remote DB rollout 여부는 이번 review에서 재확인하지 않았다.

## INC-007 | 2026-04-02 | latest docs follow-up 이후에도 invitee 코드 문구와 source-baseline이 intermediate 상태로 남은 drift

- symptom:
  - referral SSOT와 `.claude` 로그 일부가 invitee 코드 표시를 여전히 `추천인 현재 활성 코드`처럼 읽히게 적고 있었고, 일부 work-log 표현도 latest self-service/source follow-up 이전 intermediate wording을 남기고 있었다.
- impact:
  - 운영자와 후속 에이전트가 current UI 의미를 잘못 이해하거나, source repo 기준 grant baseline과 self-service path를 다시 잘못 인용할 수 있었다.
- trigger:
  - 2026-04-02 verification follow-up에서 current worktree의 `hooks/use-my-referral-code.ts`, `supabase/schema.sql`, `20260401000001_fix_referral_code_fn_anon_grant.sql`, 관리자 대시보드 문구를 다시 대조했을 때.
- rootCause:
  - 2026-04-01~2026-04-02 문서 정리 사이에 일부 요약/이력 문구가 intermediate 설명을 유지했고, invitee 표시 의미와 source-baseline 문장이 latest follow-up까지 함께 따라가지 못했다.
- fix:
  - referral SSOT와 `.claude` 문서를 `가입 시 사용한 추천코드` 의미, `get-my-referral-code` current hook path, source repo의 `service_role`-only baseline 기준으로 다시 정렬했다.
  - historical work-log 표현도 current readers가 obsolete intermediate state를 current contract로 오해하지 않도록 다듬었다.
- linkedCases:
  - RF-ADMIN-01
  - RF-SELF-01
  - RF-SEC-02
- evidence:
  - 코드 검토: `hooks/use-my-referral-code.ts`
  - schema/migration 검토: `supabase/schema.sql`, `supabase/migrations/20260401000001_fix_referral_code_fn_anon_grant.sql`
  - UI 문구 검토: `app/dashboard.tsx`, `web/src/app/dashboard/page.tsx`
  - 문서 갱신: `docs/referral-system/*`, `.claude/PROJECT_GUIDE.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- reproduction:
  1. referral 문서와 `.claude` 로그에서 invitee 코드 의미, self-service path, grant baseline 문구를 읽는다.
  2. current worktree의 hook, schema/migration, 관리자 UI 보조 문구를 확인한다.
  3. 일부 문서가 latest follow-up 이전 intermediate 상태를 남겨 둔 지점을 확인한다.
- regressionCheck:
  - RF-ADMIN-01은 운영 화면에서 invitee 코드 의미를 `가입 시 사용한 추천코드`로 기록한다.
  - RF-SELF-01은 current hook path를 `get-my-referral-code` 기준으로 유지한다.
  - RF-SEC-02는 repo source baseline(`service_role` only)과 remote rollout 검증 결과를 분리해서 남긴다.
- notes:
  - 이번 항목도 runtime bug가 아니라 docs/governance drift다.
  - 관리자 UI의 실제 표시 문자열은 화면별 미세 차이가 있을 수 있으므로, 문서에서는 의미 계약을 `가입 시 사용한 추천코드`로 통일한다.

## INC-006 | 2026-04-02 | FC self-service 추천코드 조회 경계를 session-derived path로 재정렬하고 legacy alias를 harden

- symptom:
  - FC self-service 추천코드 조회의 active path는 이미 `get-my-referral-code`로 정렬할 수 있었지만, settings 노출 조건과 legacy `get-fc-referral-code` alias 경계가 완전히 정리되지 않았다.
- impact:
  - request_board-linked 설계매니저 세션이 설정 화면에서 불필요한 self-service 오류를 볼 수 있었고, legacy alias가 남아 있는 동안 caller-supplied phone 계약이 current boundary처럼 오해될 수 있었다.
- trigger:
  - 2026-04-02 self-service referral-code retrieval trust boundary 정리 작업에서 hook/settings/function을 다시 맞췄을 때.
- rootCause:
  - `get-my-referral-code` active path 전환, request_board designer visibility 예외, `get-fc-referral-code` compatibility alias hardening이 한 번에 정리되지 않았다.
- fix:
  - `hooks/use-my-referral-code.ts`는 `get-my-referral-code` active path를 유지하고 request_board designer 세션에서는 query를 비활성화했다.
  - `app/settings.tsx`는 `내 추천 코드` 카드를 `role === 'fc' && !isRequestBoardDesigner`로 제한하고, 공유/복사 실패를 사용자 경고로 처리하도록 정리했다.
  - `supabase/functions/get-fc-referral-code/index.ts`는 legacy compatibility alias로 남기되 optional `phone` body가 인증된 세션 전화번호와 일치할 때만 허용하도록 harden했다.
  - `docs/referral-system/*`, `AGENTS.md`, `.claude/WORK_*`를 current active path 기준으로 동기화했다.
- linkedCases:
  - RF-SELF-01
  - RF-SEC-02
- evidence:
  - 코드 변경: `hooks/use-my-referral-code.ts`, `app/settings.tsx`
  - 코드 변경: `supabase/functions/get-my-referral-code/index.ts`, `supabase/functions/get-fc-referral-code/index.ts`
  - 문서 변경: `docs/referral-system/SPEC.md`, `docs/referral-system/test-cases.json`, `docs/referral-system/TEST_RUN_RESULT.json`
- reproduction:
  1. FC 세션과 request_board designer 세션에서 설정 화면 추천코드 카드 노출 조건을 비교한다.
  2. `hooks/use-my-referral-code.ts`가 어떤 function path를 active hook으로 사용하는지 확인한다.
  3. legacy `get-fc-referral-code`에 다른 phone body를 넣었을 때 세션과 무관한 조회가 허용되지 않는지 확인한다.
- regressionCheck:
  - RF-SELF-01로 active hook path와 active-code 응답을 계속 확인한다.
  - RF-SEC-02로 remaining RPC grant risk와 self-service alias hardening 상태를 함께 추적한다.
- notes:
  - 이 수정은 self-service 경계만 정리한 것이다. `get_invitee_referral_code(uuid)`의 원격 DB grant 상태 재검증은 별도 후속 작업이다.

## INC-004 | 2026-04-01 | 문서/테스트 자산이 실제 추천인 rollout/trust boundary보다 앞서 나감

- symptom:
  - 추천인 문서와 테스트 자산 일부가 앱 미설치 후 자동 복원, full click-to-confirm observability, trusted-path-only read model을 이미 운영 중인 것처럼 적고 있었다.
- impact:
  - 이후 리뷰어/운영자/에이전트가 남은 리스크를 과소평가할 수 있었다.
- trigger:
  - 2026-04-01 referral review에서 rollout status와 trust boundary를 문서 기준으로 다시 대조했을 때.
- rootCause:
  - 문서가 일부 planned target 상태를 먼저 반영했고, 현재 runtime의 제약이 SSOT에 충분히 반영되지 않았다.
- fix:
  - 앱 미설치 복원은 미구현/수동 fallback으로, observability는 현재 persisted event 범위로, trust boundary는 source repo와 remote rollout을 구분해 적도록 문서를 재정렬했다.
- linkedCases:
  - RF-LINK-02
  - RF-OBS-01
  - RF-SEC-02
  - RF-SELF-01
- evidence:
  - 코드 검토: `app/_layout.tsx`, `lib/referral-deeplink.ts`, `supabase/functions/set-password/index.ts`
  - 문서 갱신: `docs/referral-system/*`, `.claude/PROJECT_GUIDE.md`
- reproduction:
  1. 기존 referral 문서에서 앱 미설치 복원, full 관찰성, trusted-path-only 서술을 읽는다.
  2. 실제 repo 구현과 비교한다.
  3. 문서가 구현보다 앞선 항목을 확인한다.
- regressionCheck:
  - RF-LINK-02로 앱 미설치 경로를 현재 수동 fallback 계약으로 고정한다.
  - RF-OBS-01로 현재 persisted event 범위를 기준으로만 타임라인 복원 여부를 기록한다.
- notes:
  - INC-005는 이 항목 이후 다시 생긴 self-service path / grant status drift를 별도로 기록한 후속 항목이다.

## INC-003 | 2026-03-31 | 동명이인 안전화 후 live hardening gap(`set-password` fallback, override migration, clear audit)

- symptom:
  - 추천인 동명이인 안전화 직후에도 `set-password`가 caller-controlled `recommender` 문자열 fallback을 받아 profile cache에 남길 수 있었고, 웹 추천인 override는 새 RPC migration이 원격 DB에 없으면 즉시 실패하며, clear 이벤트는 운영 화면 최근 이력에서 누락될 수 있었다.
- impact:
  - 추천코드 없이도 임의 추천인 이름이 `fc_profiles.recommender`에 저장될 수 있었고, 웹 override UI를 먼저 배포하면 FC 상세 저장/레거시 연결이 모두 실패했다.
- trigger:
  - 동명이인 안전화 구조를 `recommender_fc_id` + `admin_apply_recommender_override` 기반으로 확장한 직후 점검에서 확인됐다.
- rootCause:
  - `set-password`가 유효 코드가 없을 때도 `body.recommender` fallback을 profile cache에 저장하고 있었다.
  - 웹 추천인 보정은 새 RPC migration에 의존하지만, 원격 DB는 아직 미적용 상태였다.
  - referral dashboard 이벤트 조회가 clear 시 `inviter_fc_id=null`인 이벤트를 놓쳤다.
- fix:
  - `set-password`에서 caller-controlled `recommender` fallback 저장을 제거했다.
  - clear 이벤트 귀속 로직과 503 가시성을 보강했다.
- linkedCases:
  - RF-ADMIN-06
  - RF-SEC-02
- evidence:
  - 코드 변경: `supabase/functions/set-password/index.ts`
  - 코드 변경: `web/src/app/api/admin/fc/route.ts`, `web/src/lib/admin-referrals.ts`
- reproduction:
  1. 추천코드 없이 `set-password`에 임의 `recommender` 문자열을 담아 호출한다.
  2. 원격 DB migration 없이 override UI를 배포한다.
  3. clear 후 최근 이벤트를 확인한다.
- regressionCheck:
  - `RF-ADMIN-06`으로 migration 적용 후 override/link UI를 다시 검증한다.
- notes:
  - 원격 DB migration `20260331000005_admin_apply_recommender_override.sql` 적용 여부는 별도 확인이 필요하다.

## INC-002 | 2026-03-31 | 동명이인 추천인 이름 매칭으로 잘못된 코드가 붙을 수 있던 구조 위험

- symptom:
  - 관리자 화면의 추천 코드 표시와 일부 운영 보정 경로가 `fc_profiles.recommender` 이름 문자열에 기대고 있어, 동명이인이 있는 경우 잘못된 추천인 코드가 붙을 수 있었다.
- impact:
  - `김진희`, `박병준`처럼 동일 이름 FC가 존재하면 invitee의 추천 코드를 잘못 읽거나, 총무가 추천인 문자열을 잘못 저장해 구조화 relation과 화면 표시가 어긋날 위험이 있었다.
- trigger:
  - `get_invitee_referral_code(uuid)`가 이름 문자열 조인 경로를 가졌을 때.
- rootCause:
  - 추천인 식별에 `inviter_fc_id` 대신 자유입력/표시용 문자열 `fc_profiles.recommender`를 일부 조회 경로가 다시 사용했다.
- fix:
  - `fc_profiles.recommender_fc_id`를 추가하고, `get_invitee_referral_code(uuid)`와 관리자 수정 UI를 구조화 링크 기준으로 정리했다.
- linkedCases:
  - RF-DATA-02
  - RF-ADMIN-06
- evidence:
  - 코드 변경: `supabase/migrations/20260331000004_add_structured_recommender_links.sql`
  - 코드 변경: `web/src/app/dashboard/referrals/page.tsx`
- reproduction:
  1. 동명이인 FC가 둘 이상 존재하는 데이터에서 invitee의 `recommender`에 이름 문자열만 저장한다.
  2. 관리자 화면에서 추천 코드 조회 또는 추천인 수정 UI를 연다.
  3. 이름이 같은 다른 FC의 활성 코드가 잘못 붙는지 확인한다.
- regressionCheck:
  - `RF-DATA-02`로 함수 조회 기준을 고정한다.
  - `RF-ADMIN-06`으로 관리자 수동 보정이 계정 선택형 + 감사 로그로만 동작하는지 확인한다.

## INC-001 | 2026-03-31 | Android 추천코드 입력 시 대문자가 중복 입력되던 문제

- symptom:
  - 회원가입 화면 추천코드 칸에 소문자 `j`를 입력하면 `JJ`, `ab`를 입력하면 `AABB`처럼 문자가 중복 입력됐다.
- impact:
  - Android 실기기에서 추천코드 수동 입력이 사실상 불가능해졌다.
- trigger:
  - 추천코드 입력을 controlled `TextInput`으로 유지한 상태에서 `onChangeText` 안에서 대문자 정규화와 추가 native write를 같이 수행했을 때.
- rootCause:
  - Android IME 조합 중인 텍스트와 React Native controlled value 동기화가 충돌했다.
- fix:
  - `app/signup.tsx` 추천코드 입력에서 `value` prop을 제거해 uncontrolled 패턴으로 전환했다.
- linkedCases:
  - RF-CODE-07
- evidence:
  - 코드 변경: `app/signup.tsx`
- reproduction:
  1. Android 실기기에서 회원가입 화면을 연다.
  2. 추천코드 칸에 소문자 `j` 또는 `ab`를 입력한다.
  3. 입력값이 `J`/`AB`가 아니라 중복되는지 확인한다.
- regressionCheck:
  - `RF-CODE-07`로 승격했다.
