# 추천인 시스템 장애 기록

## 1. 목적

- 추천인 시스템에서 한 번이라도 발생한 문제를 재현 가능한 형태로 남긴다.
- 같은 문제가 다시 발생했을 때 AI가 이 파일과 연결된 테스트 케이스만으로 바로 재현/검증할 수 있어야 한다.

## 2. 현재 상태

- `2026-04-04` 기준 등록된 추천인 이슈는 `12건`이다.
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
| INC-012 | 2026-04-04 | self-service `내가 초대한 사람들` 목록이 attribution-only + 50건 상한 때문에 일부 invitee를 누락함 | `RF-SELF-03` | fixed |
| INC-011 | 2026-04-04 | 본부장 추천인 self-service 후속 결함(legacy session restore, trusted read, audit trail mismatch) | `RF-SELF-01`, `RF-SELF-02`, `RF-SEC-02` | fixed |
| INC-010 | 2026-04-04 | 본부장이 추천인 self-service 대상인데 홈 바로가기/코드 발급 대상에서 빠져 있었음 | `RF-ADMIN-03`, `RF-SELF-01` | fixed |
| INC-009 | 2026-04-03 | 추천인 그래프가 confirmed-only edge와 미완성 interaction 때문에 실사용 탐색기로 동작하지 않음 | `RF-ADMIN-07`, `RF-ADMIN-08` | fixed |
| INC-008 | 2026-04-02 | 추천인 hardening gap(`set-password` OTP bypass/duplicate wipe, FC cache tampering, historical code drift) | `RF-DATA-02`, `RF-SEC-03`, `RF-SEC-04`, `RF-SEC-05` | fixed |
| INC-007 | 2026-04-02 | latest docs follow-up 이후에도 invitee 코드 문구와 source-baseline이 intermediate 상태로 남은 drift | `RF-ADMIN-01`, `RF-SELF-01`, `RF-SEC-02` | fixed |
| INC-006 | 2026-04-02 | FC self-service 추천코드 조회 경계를 session-derived path로 재정렬하고 legacy alias를 harden | `RF-SELF-01`, `RF-SEC-02` | fixed |
| INC-005 | 2026-04-01 | self-service 경로와 RPC grant 상태가 최신 worktree와 다시 어긋난 문서/로그 drift | `RF-SELF-01`, `RF-SEC-02` | fixed |
| INC-004 | 2026-04-01 | 문서/테스트 자산이 실제 추천인 rollout/trust boundary보다 앞서 나감 | `RF-LINK-02`, `RF-OBS-01`, `RF-SEC-02`, `RF-SELF-01` | fixed |
| INC-003 | 2026-03-31 | 동명이인 안전화 후 live hardening gap(`set-password` fallback, override migration, clear audit) | `RF-ADMIN-06`, `RF-SEC-02` | mitigated |
| INC-002 | 2026-03-31 | 동명이인 추천인 이름 매칭으로 잘못된 코드가 붙을 수 있던 구조 위험 | `RF-DATA-02`, `RF-ADMIN-06` | fixed |
| INC-001 | 2026-03-31 | Android 추천코드 입력 시 대문자가 중복 입력되던 문제 | `RF-CODE-07` | fixed |

## INC-012 | 2026-04-04 | self-service `내가 초대한 사람들` 목록이 attribution-only + 50건 상한 때문에 일부 invitee를 누락함

- symptom:
  - 가람in 추천인 코드 페이지의 `내가 초대한 사람들` 목록에서 실제보다 적은 수의 invitee만 보였다.
  - 특히 `fc_profiles.recommender_fc_id` 구조화 링크는 있지만 `referral_attributions` row가 없는 invitee가 목록에서 빠졌고, attribution row가 많으면 `limit(50)` 때문에 뒷부분 invitee도 잘렸다.
- impact:
  - FC/본부장이 앱에서 자기 invitee 수를 신뢰할 수 없었고, 관리자 그래프/운영 화면과 self-service 앱 목록이 서로 다른 숫자를 보여줄 수 있었다.
- trigger:
  - 2026-04-04 운영 피드백으로 “추천인 코드 페이지에서도 내가 초대한 사람이 일부만 표시된다”는 보고가 들어왔을 때.
- rootCause:
  - `supabase/functions/get-my-invitees/index.ts`가 `referral_attributions.inviter_fc_id = me`만 조회하고 있었고, 현재 구조화 추천 관계 SSOT인 `fc_profiles.recommender_fc_id = me`를 합치지 않았다.
  - 같은 함수가 attribution 조회에 `limit(50)`을 걸어 초대 인원이 많을 때 나머지를 조용히 잘라냈다.
- fix:
  - `get-my-invitees`를 `referral_attributions`와 `fc_profiles.recommender_fc_id` 구조화 링크를 함께 읽어 merge/dedupe 하도록 바꿨다.
  - 구조화 링크만 있고 attribution이 없는 invitee는 self-service 목록에서 `confirmed` synthetic row로 보이게 했다.
  - 정적 `limit(50)`을 제거해 invitee 목록이 임의 상한 때문에 부분만 보이지 않도록 정리했다.
- linkedCases:
  - RF-SELF-03
- evidence:
  - 코드 변경: `supabase/functions/get-my-invitees/index.ts`
  - 정적 검증: `npx eslint hooks/use-my-invitees.ts app/referral.tsx`
  - 정적 검증: TypeScript transpile parse for `supabase/functions/get-my-invitees/index.ts`
- reproduction:
  1. inviter 기준으로 `fc_profiles.recommender_fc_id = inviter`인 completed invitee가 있지만 `referral_attributions.inviter_fc_id = inviter` row는 일부만 있는 데이터를 준비한다.
  2. 또는 inviter attribution row가 50건을 넘는 계정으로 self-service 추천인 페이지를 연다.
  3. `내가 초대한 사람들` 목록이 실제 invitee 수보다 적게 보이는지 확인한다.
- regressionCheck:
  - RF-SELF-03으로 앱 목록, 함수 응답, DB merge count를 함께 다시 확인한다.
- notes:
  - 구현과 정적 검증은 완료했지만, 실제 inviter 계정 기준의 live count 대조 증적은 후속으로 남겨야 한다.

## INC-011 | 2026-04-04 | 본부장 추천인 self-service 후속 결함(legacy session restore, trusted read, audit trail mismatch)

- symptom:
  - manager self-service 허용 이후에도 구 로컬 세션에 `role='manager'`가 남아 있으면 홈/설정/referral gate가 다시 닫혀 본부장이 재로그인 전까지 추천인 화면을 못 볼 수 있었다.
  - 추천인 페이지는 현재 추천인을 direct client `fc_profiles` query로 읽고 실패를 숨겨서, 실제 recommender가 있어도 `등록된 추천인 없음`으로 잘못 보일 수 있었다.
  - `update-my-recommender`는 `source='self_update'`, `selection_source='self_update'`, 잘못된 `referral_events(fc_id, meta)` 컬럼을 써서 attribution/event write가 DB에서 실패해도 `ok: true`를 반환할 수 있었다.
- impact:
  - 본부장 self-service rollout 이후에도 legacy 설치 기기에서는 추천인 바로가기/페이지가 다시 사라질 수 있었다.
  - 추천인 현재값 표시가 trusted 경로와 어긋나 잘못된 빈 상태를 보여줄 수 있었다.
  - 추천인 self-service 변경이 성공으로 보이지만 `referral_attributions` / `referral_events` 감사 이력이 남지 않는 무결성 문제가 있었다.
- trigger:
  - 2026-04-04 subagent 병렬 리뷰에서 모바일/보안/Supabase 관점 점검을 다시 돌렸을 때.
- rootCause:
  - `hooks/use-session.tsx` restore가 legacy persisted `manager` role을 현재 앱 권한모델(`admin + readOnly`)로 재정규화하지 않았다.
  - `app/referral.tsx`가 trusted self-service 응답이 아니라 클라이언트 직접 조회로 `recommender` cache를 읽었고, refresh도 disabled query refetch를 그대로 호출했다.
  - `supabase/functions/update-my-recommender/index.ts`가 schema enum/컬럼 계약과 다른 payload를 쓰고, insert/update/event 오류를 성공 응답으로 삼켰다.
- fix:
  - `hooks/use-session.tsx`에 legacy stored `manager` role을 `admin + readOnly`로 정규화하는 restore helper를 추가했다.
  - `get-my-referral-code`가 active code와 함께 `recommender` cache를 반환하도록 넓히고, `hooks/use-my-referral-code.ts`, `app/settings.tsx`, `app/referral.tsx`는 그 trusted 응답만 사용하도록 바꿨다.
  - `app/referral.tsx` refresh는 self-service 가능 세션에서만 refetch하고 `try/finally`로 spinner 정리를 보장하도록 수정했다.
  - `update-my-recommender`는 `manual_entry` / `manual_entry_only` 계약으로 attribution을 갱신하고, `referral_events(invitee_fc_id, metadata)` 경로로 audit row를 남기며 DB 오류 시 성공을 반환하지 않도록 보정했다.
  - 수정된 `get-my-referral-code`, `update-my-recommender`를 linked project `ubeginyxaotcamuqpmud`에 재배포했다.
- linkedCases:
  - RF-SELF-01
  - RF-SELF-02
  - RF-SEC-02
- evidence:
  - 코드 변경: `hooks/use-session.tsx`, `hooks/use-my-referral-code.ts`, `app/settings.tsx`, `app/referral.tsx`
  - 코드 변경: `supabase/functions/get-my-referral-code/index.ts`, `supabase/functions/update-my-recommender/index.ts`
  - 검증: `npx eslint app/settings.tsx app/referral.tsx hooks/use-my-referral-code.ts hooks/use-session.tsx`
  - 검증: TypeScript transpile parse for `get-my-referral-code`, `update-my-recommender`
  - 배포: `supabase functions deploy get-my-referral-code --project-ref ubeginyxaotcamuqpmud`
  - 배포: `supabase functions deploy update-my-recommender --project-ref ubeginyxaotcamuqpmud`
- reproduction:
  1. 구 앱 로컬 세션에 `role='manager'` payload가 남아 있는 상태로 앱을 복원한다.
  2. 추천인 페이지에서 현재 추천인 표시에 필요한 self-service read를 direct client query로 처리하거나, blocked/token-missing 상태에서 pull-to-refresh를 실행한다.
  3. 추천인 변경 저장을 실행하면 attribution/event write가 schema와 어긋나도 성공 응답으로 끝나는지 확인한다.
- regressionCheck:
  - RF-SELF-01로 legacy manager session restore와 trusted self-service read path를 다시 확인한다.
  - RF-SELF-02로 추천인 self-service 저장 후 current recommender 표시 + attribution/event trail을 함께 확인한다.
  - RF-SEC-02로 direct client access가 아니라 trusted path만 읽기/쓰기를 수행하는지 유지 확인한다.
- notes:
  - 정적 검증과 Edge Function 재배포는 완료했다.
  - 실제 본부장 계정으로 추천인 검색/저장까지 on-device 증적을 남기는 검증은 별도 후속이다.

## INC-009 | 2026-04-03 | 추천인 그래프가 confirmed-only edge와 미완성 interaction 때문에 실사용 탐색기로 동작하지 않음

- symptom:
  - `/dashboard/referrals/graph`에서 추천 관계 선이 비어 보였고, 노드를 잡아 움직이기 어렵거나 빈 공간 drag로 화면을 이동하기 어려웠다.
  - node label이 제한적으로만 보여 실제 운영자가 전체 네트워크를 읽기 어려웠다.
- impact:
  - 운영자가 graph를 열어도 구조화 추천 관계를 바로 읽지 못했고, 추천인 네트워크 탐색 도구로 쓰기 어려웠다.
- trigger:
  - 2026-04-03 운영 피드백에서 `confirmed referral_attributions`가 0건인 현재 DB 상태와 graph interaction 부족이 같이 드러났을 때.
- rootCause:
  - visible edge 생성이 `confirmed referral_attributions`에 과도하게 기대고 있었고, current runtime의 주된 구조화 링크 소스인 `fc_profiles.recommender_fc_id`가 graph surface의 기본 edge source로 충분히 반영되지 않았다.
  - canvas는 custom node draw 대비 hit area, layout control, label strategy, drag/pan 사용성이 충분히 정리되지 않았다.
- fix:
  - graph edge 기본 소스를 `fc_profiles.recommender_fc_id`로 두고, `confirmed referral_attributions`는 same pair edge의 `relationshipState`를 강화하는 보조 증거로 merge했다.
  - graph page를 read-first surface로 재정리하고 mutation CTA를 제거했다.
  - canvas에 node drag, 빈 캔버스 pan, fit/reset, force tuning, 기본 node name label 표시를 반영했다.
- linkedCases:
  - RF-ADMIN-07
  - RF-ADMIN-08
- evidence:
  - 코드 변경: `web/src/lib/admin-referrals.ts`
  - 코드 변경: `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - 코드 변경: `web/src/app/dashboard/referrals/graph/page.tsx`
  - API smoke: eligible FC 110, merged edges 41, relationshipCounts `{ structured: 41, confirmed: 0, structured_confirmed: 0 }`
  - 정적 검증: `cd web && npm run lint -- ...`, `cd web && npx next build`
- reproduction:
  1. `confirmed referral_attributions`가 없는 현재 운영 데이터 기준으로 `/dashboard/referrals/graph`를 연다.
  2. graph가 structured link를 기본 edge로 쓰지 않으면 연결선이 비어 보인다.
  3. custom node draw/hit area/pan/label 정책이 부족하면 drag/pan/readability 문제가 같이 드러난다.
- regressionCheck:
  - RF-ADMIN-07로 graph API와 page가 빈 edge 없이 structured link를 먼저 보여주는지 확인한다.
  - RF-ADMIN-08로 node drag, 빈 공간 pan, reset, label 가시성을 다시 확인한다.
- notes:
  - 이번 수정은 lint/build/API smoke까지 완료했지만, 브라우저 상호작용 실기 확인은 별도 후속 증적이 필요하다.

## INC-008 | 2026-04-02 | 추천인 hardening gap(`set-password` OTP bypass/duplicate wipe, FC cache tampering, historical code drift)

- symptom:
  - `set-password`가 fresh number direct call에서도 새 FC profile/credentials를 만들 수 있었고, duplicate/direct call에서는 `already_set`를 반환하기 전에 기존 추천인/온보딩 상태를 먼저 지울 수 있었다.
  - FC 기본정보 화면(`/fc/new`)은 가입 후에도 `fc_profiles.recommender`를 일반 사용자 자유입력으로 저장할 수 있었다.
  - `get_invitee_referral_code(uuid)`는 inviter가 나중에 코드를 rotate하면 `가입 시 사용한 추천코드` 대신 현재 활성 코드를 먼저 보여줄 수 있었다.
- impact:
  - OTP 검증 없이 FC 계정을 생성하거나, 중복 가입 시도로 기존 추천인/온보딩 상태를 훼손할 수 있었다.
  - 일반 FC가 추천인 표시 cache를 임의로 바꿔 구조화 추천 관계와 운영 화면 의미를 어지럽힐 수 있었다.
  - 운영자와 관리자 화면이 historical signup code 대신 현재 inviter active code를 보여줘 감사/CS 판단을 오도할 수 있었다.
- trigger:
  - 2026-04-02 referral audit에서 `supabase/functions/set-password/index.ts`, `app/fc/new.tsx`, `supabase/schema.sql`을 current SSOT와 대조했을 때.
- rootCause:
  - `set-password`가 OTP-verified existing-profile invariant를 스스로 강제하지 않았고, duplicate guard보다 destructive reset/update가 먼저 실행됐다.
  - 일반 FC 기본정보 편집 화면에서 legacy `recommender` cache write path가 남아 있었다.
  - invitee code lookup이 current active code fallback을 historical confirmed attribution보다 앞에 두고 있었다.
- fix:
  - `set-password`에서 fresh-number insert branch를 제거하고 `phone_verified=true` existing profile만 통과시키도록 바꿨다.
  - `fc_credentials.password_set_at` 확인을 profile reset/update보다 앞으로 이동했다.
  - `/fc/new`에서 추천인 자유입력 필드를 제거하고 읽기 전용 표시로 교체했으며 저장 payload에서 `recommender`를 제외했다.
  - `get_invitee_referral_code(uuid)`와 대응 migration을 historical-first order로 바꿨다.
  - referral SSOT, handbook, contracts, work logs, harness 문서를 현재 hardening 기준으로 갱신했다.
- linkedCases:
  - RF-DATA-02
  - RF-SEC-03
  - RF-SEC-04
  - RF-SEC-05
- evidence:
  - 코드 변경: `supabase/functions/set-password/index.ts`
  - 코드 변경: `app/fc/new.tsx`
  - 스키마/마이그레이션 변경: `supabase/schema.sql`, `supabase/migrations/20260402000002_fix_invitee_referral_code_history_priority.sql`
  - 문서 변경: `docs/referral-system/*`, `.claude/PROJECT_GUIDE.md`, `docs/handbook/*`, `contracts/*`
- reproduction:
  1. fresh number 또는 미인증 profile phone으로 `set-password`를 직접 호출한다.
  2. 이미 `password_set_at`가 있는 FC로 `set-password`를 다시 호출한다.
  3. `/fc/new`에서 추천인 값을 바꿔 저장하거나, inviter code rotation 후 관리자 invitee code 표시를 확인한다.
- regressionCheck:
  - RF-DATA-02로 historical signup code priority를 다시 검증한다.
  - RF-SEC-03으로 fresh-number direct call non-create를 확인한다.
  - RF-SEC-04로 duplicate call before/after DB 값을 비교한다.
  - RF-SEC-05로 `/fc/new` read-only behavior와 DB 보존을 확인한다.
- notes:
  - 이번 수정은 코드와 문서 hardening까지 반영했지만, 새 P0/P1 회귀 케이스의 live runtime evidence는 아직 수집하지 않았다.

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
## INC-010 | 2026-04-04 | 본부장이 추천인 self-service 대상인데 홈 바로가기/코드 발급 대상에서 빠져 있었음

- symptom:
  - 본부장 세션에서는 홈에 `추천인 코드` 바로가기가 보이지 않았고, self-service 화면/설정 카드도 사실상 FC 전용으로만 열려 있었다.
  - 추천코드 운영 백필/재발급 대상에서도 `manager_accounts`와 전화번호가 겹치는 completed FC가 제외되어 본부장에게 active code를 줄 수 없었다.
- impact:
  - 본부장이 FC 역할로 친구 초대/코드 공유를 해야 하는 운영 계약과 실제 앱/운영 발급 정책이 어긋나 있었다.
  - 홈에서 추천인 페이지로 진입하지 못하거나, 운영자가 backfill을 돌려도 본부장 FC에는 code가 생기지 않았다.
- trigger:
  - 2026-04-04 운영 요청으로 “본부장도 FC이므로 추천인 코드 바로가기가 보이고 코드를 할당 받아야 한다”는 요구가 재확인됐을 때.
- rootCause:
  - 모바일 앱은 manager login을 `admin + readOnly` UI role로 정규화하지만, 추천인 self-service 노출 조건이 `role === 'fc'`로만 묶여 있었다.
  - self-service Edge Function과 운영 backfill/admin issuance 함수가 모두 `manager` source role 또는 `manager_accounts` overlap을 추천코드 예외 대상으로 취급하고 있었다.
- fix:
  - 홈/설정/추천인 화면 훅에서 `manager source role -> admin/readOnly UI` 세션도 self-service 허용 대상으로 포함했다.
  - `get-my-referral-code`, `get-fc-referral-code`, `get-my-invitees`, `search-fc-for-referral`, `update-my-recommender`가 `manager` app-session을 허용하도록 정렬했다.
  - `admin_issue_referral_code`, `admin_backfill_referral_codes`, `web/src/lib/admin-referrals.ts`에서 manager overlap exclusion을 제거해 본부장-linked completed FC도 code issuance/backfill 대상에 포함했다.
- linkedCases:
  - RF-ADMIN-03
  - RF-SELF-01
- evidence:
  - 코드 변경: `app/index.tsx`, `app/settings.tsx`, `app/referral.tsx`
  - 코드 변경: `hooks/use-my-referral-code.ts`, `hooks/use-my-invitees.ts`
  - 코드 변경: `supabase/functions/get-my-referral-code/index.ts`, `supabase/functions/get-fc-referral-code/index.ts`, `supabase/functions/get-my-invitees/index.ts`, `supabase/functions/search-fc-for-referral/index.ts`, `supabase/functions/update-my-recommender/index.ts`
  - 코드 변경: `supabase/schema.sql`, `supabase/migrations/20260404000001_allow_manager_referral_codes.sql`, `web/src/lib/admin-referrals.ts`
- reproduction:
  1. 본부장 계정으로 앱에 로그인한다.
  2. 홈 바로가기와 설정에서 추천인 코드 진입 동선을 확인한다.
  3. 운영자 backfill 기준을 보면 `manager_accounts` overlap completed FC가 발급 대상에서 빠져 있었다.
- regressionCheck:
  - RF-SELF-01로 FC/본부장 self-service active code 조회를 다시 확인한다.
  - RF-ADMIN-03으로 본부장-linked completed FC를 포함한 backfill idempotency를 다시 확인한다.
- notes:
  - 이번 세션에서는 코드/문서/스키마 계약까지 정리했다. 실제 원격 DB migration 적용 뒤 본부장 실계정 기준의 on-device 검증은 별도로 남아 있다.
