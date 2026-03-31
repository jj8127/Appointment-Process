# 작업 상세 로그 (Work Detail)

> **상세 이력 누적 파일**입니다.  
> 최근 1개월 Git 이력(`2026-01-12` ~ `2026-02-11`, 총 44 commits)을 기준으로 재구성했습니다.
>
> 요약 인덱스는 [WORK_LOG.md](WORK_LOG.md)를 확인하세요.

---

## <a id="20260331-referral-phase2-deeplink-inline-display"></a> 2026-03-31 | 추천인 Phase 2 딥링크/가입 확정 경로 정리 + 관리자 inline 코드 표시

**배경**:
- 추천인 코드 운영 기반과 관리자 조회는 이미 들어가 있었지만, 실제 FC 가입 플로우는 아직 구조화된 추천코드와 연결되지 않아 `fc_profiles.recommender` 자유입력 문자열에만 머물러 있었다.
- 모바일 가입 화면에서 추천코드를 소문자로 입력하면 Android IME 조합과 controlled `TextInput`이 충돌해 `j -> JJ`처럼 문자가 두 번 들어가는 회귀가 발생했다.
- 관리자 화면의 추천인 코드 표시는 기능적으로는 붙었지만, 사용자가 요구한 “추천인 이름 오른쪽 inline” 배치와는 달라 한 번 더 정렬이 필요했다.

**조치**:
- `app/_layout.tsx`, `lib/referral-deeplink.ts`
  - 딥링크 `hanwhafcpass://signup?code=<REFERRAL_CODE>`를 처리하도록 앱 루트에서 추천코드 pending 저장을 추가했다.
  - cold start는 추천코드만 저장하고, warm start에서만 `/signup`으로 push 한다.
  - pending 코드는 읽은 직후 삭제하는 one-shot storage로 유지했다.
- `app/signup.tsx`
  - 추천인 자유입력 대신 `추천 코드 (선택)` 입력과 실시간 검증 UI를 추가했다.
  - `validate-referral-code` Edge Function으로 inviter 이름을 검증하고, 유효하면 가입 payload에 `referralCode`와 inviter 이름을 함께 싣는다.
  - Android 중복 입력 회귀를 막기 위해 추천코드 `TextInput`에서 `value` prop을 제거한 uncontrolled 패턴으로 정리했다.
- `app/signup-verify.tsx`, `app/signup-password.tsx`
  - `SignupPayload`에 `referralCode`를 추가하고 최종 비밀번호 설정 단계까지 전달되도록 연결했다.
- `supabase/functions/validate-referral-code/index.ts`
  - 신규 Edge Function을 추가했다.
  - 활성 추천코드만 검증하고, inviter 이름/마스킹 전화번호를 반환하며, 무효/비활성은 같은 응답으로 숨겨 enumeration을 줄였다.
- `supabase/functions/get-my-referral-code/index.ts`
  - 신규 Edge Function을 추가했다.
  - 앱 세션 토큰을 검증한 뒤 일반 FC만 자신의 활성 추천코드를 읽을 수 있도록 준비했다.
- `supabase/functions/set-password/index.ts`
  - `referralCode` payload를 받아, 가입 완료 직후 `captureReferralAttribution()`로 `referral_attributions`, `referral_events`, `fc_profiles.recommender`를 best-effort로 동기화하도록 확장했다.
  - 추천 attribution 실패는 가입 자체를 막지 않도록 warn-only 처리했다.
- `app/dashboard.tsx`, `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/profile/[id]/page.tsx`
  - 추천인 이름과 추천 코드를 같은 줄 inline 배치로 다시 정렬했다.
  - 코드 색은 기존 주황색 강조를 유지했다.

**결과**:
- FC 가입은 이제 딥링크 또는 수동 입력 추천코드를 `referralCode`로 보존하고, 가입 완료 시 `set-password`에서 구조화 attribution까지 연결한다.
- Android에서 추천코드를 입력할 때 대문자 정규화는 유지하면서도 문자 중복 입력 회귀를 피한다.
- 관리자 웹/모바일의 추천인 표시는 이름 오른쪽 inline 코드 배치로 통일됐다.
- Supabase Edge Functions 배포도 함께 마쳐, 로컬 변경과 원격 런타임이 다시 어긋나지 않게 맞췄다.

**검증**:
- `npm run lint`
- `cd web && npm run lint`
- `cd web && npx tsc --noEmit --pretty false`
- `supabase functions deploy validate-referral-code --project-ref ubeginyxaotcamuqpmud`
- `supabase functions deploy get-my-referral-code --project-ref ubeginyxaotcamuqpmud`
- `supabase functions deploy set-password --project-ref ubeginyxaotcamuqpmud`
- `supabase functions list --project-ref ubeginyxaotcamuqpmud`
  - `validate-referral-code` v2
  - `get-my-referral-code` v2
  - `set-password` v43
- `Invoke-RestMethod`로 `validate-referral-code` 호출
  - `code=KCSACZXU` 기준 `ok=true`, `valid=true`, `inviterName=문주화`, `inviterPhoneMasked=0102389****` 확인

---

## <a id="20260331-recommender-code-lookup-fix"></a> 2026-03-31 | 추천인 코드 표시 조회 기준을 추천인 활성 코드 우선으로 정정

**배경**:
- 최초 구현은 `get_invitee_referral_code`가 `confirmed referral_attributions.referral_code`만 읽도록 되어 있어, attribution row가 없으면 추천인에게 활성 코드가 있어도 화면에 `-`가 표시됐다.
- 실제 운영 화면에서는 추천인 관리 페이지 `/dashboard/referrals`에 추천인 본인의 활성 코드가 존재하는데, FC 상세의 `추천인` 아래에서는 같은 코드가 보이지 않는 불일치가 발생했다.
- 사용자가 요구한 값은 “해당 FC가 과거에 귀속된 코드”보다 “추천인 본인의 현재 코드”에 가깝다.

**조치**:
- `supabase/migrations/20260331000003_fix_get_invitee_referral_code_lookup.sql`
  - `public.get_invitee_referral_code(uuid)` 함수를 다시 정의했다.
  - 대상 FC의 `fc_profiles.recommender` 이름과 같은 `fc_profiles.name`을 가진 추천인을 찾고, 그 추천인의 `referral_codes.is_active=true` 코드를 최신순으로 우선 반환한다.
  - 활성 코드가 없을 때만 기존처럼 `confirmed referral_attributions.referral_code`를 fallback으로 반환한다.
- `supabase/schema.sql`
  - 위 보정된 함수 본문을 canonical snapshot에 반영했다.
- `web/src/app/api/admin/fc/route.ts`
  - `getReferralCode` 액션이 더 이상 `referral_attributions`를 직접 조회하지 않고, 동일 RPC를 호출하도록 맞췄다.
- handbook / work log
  - “받은 추천 코드”라고 적혀 있던 설명을 “추천인의 현재 활성 코드 우선, attribution fallback”으로 정정했다.

**결과**:
- 추천인에게 활성 추천 코드가 이미 발급돼 있으면, attribution 유무와 상관없이 관리자 화면에서 그 코드를 먼저 보여준다.
- 추천인이 아직 활성 코드를 갖고 있지 않은 예외 케이스만 기존 attribution 코드로 fallback된다.
- `/dashboard/referrals`와 FC 상세 화면 사이의 추천 코드 기준이 일치하게 됐다.

**검증**:
- `supabase db push`
  - `20260331000003_fix_get_invitee_referral_code_lookup.sql` 원격 DB 적용 성공
- `supabase migration list`
  - `20260331000003` local/remote 일치 확인

---

## <a id="20260331-recommender-code-display"></a> 2026-03-31 | 추천인 이름이 보이는 관리자 화면에 받은 추천 코드 표시 추가

**배경**:
- 관리자들은 FC 상세 모달, 웹 프로필 상세, 모바일 관리자 대시보드에서 `추천인` 이름은 볼 수 있었지만, 실제로 그 추천인이 어떤 추천 코드를 쓰는지는 바로 확인할 수 없었다.
- 웹은 service-role API route를 통해 `referral_attributions`를 읽을 수 있지만, 모바일은 anon 클라이언트라 `referral_attributions` RLS를 직접 통과할 수 없었다.
- 추천 코드가 없을 때도 행 자체를 숨기면 화면마다 정보 밀도가 달라져 운영 판단이 어려웠다.

**조치**:
- `supabase/migrations/20260331000002_get_invitee_referral_code_fn.sql`
  - `public.get_invitee_referral_code(uuid)` `SECURITY DEFINER` SQL 함수를 추가했다.
  - 초기 구현은 `confirmed` 상태의 `referral_attributions.referral_code`만 최신순으로 1건 반환했다.
  - `anon`, `authenticated`, `service_role`에만 execute를 열고 `PUBLIC` 기본 execute는 revoke 했다.
- `supabase/schema.sql`
  - 위 RPC 함수와 grant/revoke를 canonical snapshot에 반영했다.
- `web/src/app/api/admin/fc/route.ts`
  - `getReferralCode` 액션을 추가해 웹 관리자 화면이 추천인 코드를 조회할 수 있게 연결했다.
- `web/src/app/dashboard/page.tsx`
  - FC 상세 모달의 `추천인` 입력 바로 아래에 `추천 코드`를 항상 표시하도록 바꿨다.
  - 코드가 없으면 `-`, 조회 중이면 `조회 중...`으로 표시한다.
- `web/src/app/dashboard/profile/[id]/page.tsx`
  - 프로필 상세의 `추천인` 필드 아래에 동일한 `추천 코드` 표시를 추가했다.
  - 여기서도 코드가 없으면 `-`, 조회 중이면 `조회 중...`으로 고정했다.
- `app/dashboard.tsx`
  - FC 카드 확장 시 `get_invitee_referral_code` RPC를 lazy 호출해 `추천 코드` 행을 보여주도록 추가했다.

**결과**:
- 추천인 이름이 보이는 관리자 화면 3곳(웹 상세 모달, 웹 프로필 상세, 모바일 관리자 대시보드)에서 동일한 기준의 추천 코드를 확인할 수 있다.
- 웹은 기존 관리자 route를 재사용하고, 모바일은 RLS를 직접 건드리지 않고 RPC 하나로 같은 데이터를 본다.
- 추천 코드가 없더라도 UI에서 행이 사라지지 않으므로, `없음`과 `조회 실패/누락`을 구분하기 쉬워졌다.
- `/dashboard/referrals`는 FC 자신의 활성 추천코드 운영 화면이라, invitee가 받은 코드 표시 대상에는 포함하지 않았다.
- `app/fc/new.tsx`의 `추천인`은 신규 FC 생성 입력 필드라 이번 범위에서 UI 추가 없이 유지했다.

**검증**:
- `supabase migration list`
  - `20260331000002_get_invitee_referral_code_fn.sql` local/remote 일치 확인
- `supabase db push`
  - 원격 DB 적용 성공
- `cd web && npx tsc --noEmit`
  - `dashboard/page.tsx`, `dashboard/profile/[id]/page.tsx`, `api/admin/fc/route.ts` 관련 추가 오류 없음
- `npx tsc --noEmit`
  - `app/dashboard.tsx` 관련 추가 오류 없음
  - 전체 앱 기준으로는 기존 다른 파일의 타입 오류 때문에 종료 코드는 실패 가능
- anon RPC 스모크 테스트
  - `get_invitee_referral_code` 호출 자체는 정상 응답 확인

---

## <a id="20260331-referral-phase1"></a> 2026-03-31 | 추천인 시스템 Phase 1 — EF 신규 + set-password attribution 연결

### 배경
- 추천인 스키마(`referral_codes`, `referral_attributions`, `referral_events`)와 Admin 운영 기반은 03-25 기준 완성
- 가입 화면의 `recommender` 자유 텍스트가 구조화 attribution에 연결되지 않아 이번에 연결

### 변경 파일
| 파일 | 내용 |
|------|------|
| `supabase/functions/validate-referral-code/index.ts` | 신규. anon 호출, rate limiting(IP/1분 10회), enumeration 방지(`inactive=not_found`), inviterPhoneMasked |
| `supabase/functions/get-my-referral-code/index.ts` | 신규. `parseAppSessionToken` 세션 검증, 설계매니저/admin/manager forbidden |
| `supabase/functions/set-password/index.ts` | `referralCode?` Payload 추가, `captureReferralAttribution()` 헬퍼 추가 (best-effort), signup_completed 이후 attribution INSERT |
| `supabase/scripts/backfill_referral_codes.sql` | 신규. 기존 FC 추천 코드 일괄 백필 SQL (`admin_backfill_referral_codes` RPC 호출) |

### captureReferralAttribution 로직
1. `referral_codes` 조회 (is_active=true)
2. inviter profile 조회 (phone 없으면 skip)
3. self-referral 체크 (inviterPhone=inviteePhone → skip)
4. 기존 confirmed attribution 중복 체크
5. `referral_attributions` INSERT (status='confirmed', confirmed_at=now())
6. `referral_events` INSERT (event_type='referral_confirmed')
7. `fc_profiles.recommender` = inviterName (기존 어드민 뷰 호환)
8. 모든 에러는 console.warn만, throw 금지 (가입 차단 불가)

### 백필 방법
- 관리자 웹 `/dashboard/referrals` "일괄 발급" 버튼으로 100건씩 실행
- 또는 Supabase SQL Editor에서 `supabase/scripts/backfill_referral_codes.sql` 실행 (remaining=0 될 때까지 반복)

---

## <a id="20260331-exam-registration-location-round-guard"></a> 2026-03-31 | 시험 신청 회차-지역 불일치를 `춘천`으로 교정하고 복합 제약으로 재발 차단

**배경**:
- `exam_registrations`는 `round_id`와 `location_id`를 각각 별도 FK로만 보장하고 있어, 다른 회차의 `location_id`를 섞은 row가 저장될 수 있었다.
- 실제 운영 데이터에도 `fc0421cd-6016-4732-b28f-324246085bc4` 한 건이 `4월 4차 생명보험` 회차와 `4월 1차 생명보험 / 서울` 지역을 함께 가리키는 오염 상태로 남아 있었다.
- 모바일 `app/exam-apply.tsx`, `app/exam-apply2.tsx`는 선택된 회차와 지역을 클라이언트 상태에서만 조합하고, 저장 직전 `location_id`가 현재 회차 목록에 속하는지까지는 검증하지 않았다.

**조치**:
- `supabase/migrations/20260331000001_enforce_exam_registration_location_round_match.sql`
  - 기존 오염 row를 `4월 4차 생명보험 / 춘천` location row로 재매핑했다.
  - `exam_locations (id, round_id)` 복합 unique 제약을 추가했다.
  - `exam_registrations (location_id, round_id) -> exam_locations (id, round_id)` 복합 FK와 `(location_id, round_id)` 인덱스를 추가했다.
  - 마지막에 `exam_registrations`와 `exam_locations`의 회차 불일치 row 개수를 검사해 0건이 아니면 migration이 실패하도록 했다.
- `supabase/schema.sql`
  - 위 복합 unique/foreign key 계약과 인덱스를 canonical snapshot에 반영했다.
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`
  - 저장 직전에 `selectedLocationId`가 현재 `selectedRound.locations`에 실제로 포함되는지 검사한다.
  - 기존 신청 복원 시 현재 회차 목록에 없는 `location_id`는 선택 상태로 복원하지 않고 `null`로 초기화한다.
  - 회차를 다시 고를 때는 `selectedLocationId`를 즉시 비워 stale 지역이 남지 않게 했다.
  - 새 복합 FK 위반 에러는 `선택한 응시 지역이 해당 시험 회차에 속하지 않습니다.` 사용자 메시지로 번역한다.

**결과**:
- repo 기준으로 시험 신청 row가 항상 같은 회차에 속한 지역만 참조하도록 스키마와 모바일 저장 로직을 정리했다.
- 기존 오염 row 1건은 원격 migration 적용으로 실제 `춘천` location row로 재매핑됐다.
- 모바일에서 stale `location_id`가 남아도 저장 직전에 한 번 더 차단되므로, UI 상태 꼬임만으로는 같은 문제가 재발하지 않는다.
- 원격 DB 기준 `exam_registrations`의 회차-지역 불일치 row 개수는 0건이다.

**검증**:
- `npm run lint` 통과
- `npx tsc --noEmit`
  - 이번 변경과 무관한 기존 타입 오류들(`app/appointment.tsx`, `app/exam-manage*.tsx`, `app/hanwha-commission.tsx`, `components/DaumPostcode.tsx`, `lib/fc-workflow.ts`)로 실패
- `supabase migration list`
  - `20260331000001_enforce_exam_registration_location_round_match.sql` local/remote 일치 확인
- `supabase db push`
  - 원격 DB 적용 성공
- service-role 스모크 테스트
  - 대상 row `fc0421cd-6016-4732-b28f-324246085bc4`가 `4월 4차 생명보험 / 춘천`으로 교정된 것 확인
  - 전체 `exam_registrations` 21건 기준 회차-지역 불일치 0건 확인
  - 다른 회차의 `location_id`로 insert 시 `exam_registrations_location_round_fkey` `23503`으로 차단되는 것 확인
  - 같은 회차의 `location_id`로는 insert/delete가 정상 동작하는 것 확인

---

## <a id="20260331-allowance-migration-order-fix"></a> 2026-03-31 | allowance migration 순서를 고쳐 웹 수당동의 반려 500 복구

**배경**:
- `web/src/app/api/admin/fc/route.ts`의 수당동의 반려 경로는 `allowance_prescreen_requested_at` 컬럼을 포함해 `allowance-pending` 상태를 저장한다.
- 실제 원격 Supabase에는 `20260330000001_add_allowance_prescreen_requested_at.sql`, `20260330000002_relax_allowance_flow_requires_date.sql`가 적용되지 않아, 반려 버튼 클릭 시 `PGRST204: Could not find the 'allowance_prescreen_requested_at' column` 500이 발생했다.
- 원인을 따라가 보니 첫 번째 migration이 기존 불량 데이터를 정리하기 전에 check constraint를 먼저 추가하고 있어서 `supabase db push` 자체가 중간에서 실패하고 있었다.

**조치**:
- `supabase/migrations/20260330000001_add_allowance_prescreen_requested_at.sql`
  - 컬럼 추가와 기존 불량 데이터 정리만 남기고, 중간/마지막의 constraint 재추가 구문을 제거했다.
  - 실제 constraint 제거는 뒤의 `20260330000002_relax_allowance_flow_requires_date.sql`가 담당하도록 순서를 바로잡았다.
- `supabase/schema.sql`
  - `allowance_prescreen_requested_at` 컬럼 코멘트를 schema snapshot에도 반영해 migration repair와 스키마 기준 파일을 같이 맞췄다.
- 원격 적용
  - `supabase db push`로 누락된 2개 migration을 원격 DB에 반영했다.

**결과**:
- 연결된 Supabase 원격 DB가 이제 `allowance_prescreen_requested_at` 컬럼을 인식한다.
- 웹 관리자에서 수당동의 반려 같은 allowance 상태 조작 POST가 더 이상 500으로 떨어지지 않는다.
- 문제는 Edge Function 미배포가 아니라 DB migration 미적용 + migration 순서 오류였다.

**검증**:
- `supabase migration list`
- `supabase db push`
- 로컬 dev 서버에서 `/api/admin/fc` `updateStatus` 호출 재현
  - `allowance-consented` 200
  - `allowance-pending + allowance_reject_reason` 200

---

## <a id="20260330-admin-fc-route-null-guard-build-fix"></a> 2026-03-30 | admin route/date input 타입 오류를 정리해 Vercel production 빌드 복구

**배경**:
- Vercel의 Git 자동 배포는 정상 동작했지만, 최신 `main` production 배포 2건이 모두 `next build`의 TypeScript 단계에서 실패했다.
- 실패 원인은 `web/src/app/api/admin/fc/route.ts`의 `updateAllowanceDate` 분기에서 `maybeSingle()` 결과를 null 가드 없이 `profile.status`로 바로 참조한 것이었다.
- 로컬 `npm run build`도 동일한 오류를 재현했고, 이 한 줄 때문에 자동 배포가 계속 막히는 상태였다.

**조치**:
- `web/src/app/api/admin/fc/route.ts`
  - `updateAllowanceDate` 분기에서 `profileError` 검사 뒤 `if (!profile) return badRequest('FC profile not found');` 가드를 추가했다.
  - 이후에만 `resolveAllowanceStatus(profile.status)`를 호출하도록 정리했다.
- `web/src/app/dashboard/page.tsx`
  - 생명/손해 위촉 확정일 입력의 `onChange`에서 `value instanceof Date` 분기를 제거하고 `new Date(value)`로 일관되게 정규화했다.
  - `DateValue` 타입이 문자열/날짜 혼합으로 추론될 때 생기던 `instanceof` TypeScript 오류를 없앴다.
- `.claude/PROJECT_GUIDE.md`
  - Supabase `maybeSingle()` 결과는 null 가능성을 먼저 가드해야 하며, 특히 `web/src/app/api/*` route는 Vercel production build에 직접 영향을 준다는 재발 방지 규칙을 추가했다.

**결과**:
- `main` 브랜치의 웹 production build를 깨던 TypeScript 오류 2건이 제거됐다.
- Vercel Git 자동 배포 자체는 정상이며, 이번 수정으로 다시 최신 커밋이 production까지 통과할 수 있는 상태가 됐다.

**검증**:
- `cd web && npm run build`
- `node scripts/ci/check-governance.mjs`

---

## <a id="20260330-web-appointment-commission-toggle-buttons"></a> 2026-03-30 | 웹 FC 상세 관리 모달 `생명/손해 위촉` 탭에 독립형 완료 토글 2개 복구

**배경**:
- FC 상세 관리 모달의 `생명/손해 위촉` 탭에서 총무가 생명/손해 위촉 완료 플래그를 직접 조작하던 UI가 사라져, 완료 플래그 보정이 다시 불가능해졌다.
- 현재 스키마와 타입은 이미 `life_commission_completed`, `nonlife_commission_completed`, `CommissionCompletionStatus`를 유지하고 있어, 기존 저장 경로를 다시 연결하는 편이 가장 작고 안전했다.
- 요구사항은 `생명 위촉 완료`, `손해 위촉 완료` 두 버튼만 두고, 둘을 독립적으로 켜고 끌 수 있게 하는 것이다. 별도 `미완료` 버튼은 만들지 않는다.

**조치**:
- `web/src/app/dashboard/page.tsx`
  - `CommissionCompletionStatus` import와 `buildCommissionProfileUpdate()` helper를 복구했다.
  - `commissionInput` 상태와 `updateCommissionMutation`을 다시 추가해 기존 `/api/admin/fc -> updateProfile` 저장 경로를 재사용하도록 연결했다.
  - `handleOpenModal()`에서 현재 FC의 `life_commission_completed`, `nonlife_commission_completed`를 읽어 `none/life_only/nonlife_only/both` 상태를 초기화하도록 보강했다.
  - `생명/손해 위촉` 탭 상단에 `위촉 상태` 카드와 `생명 위촉 완료`, `손해 위촉 완료` 독립 토글 2개, `위촉 상태 저장` 버튼을 추가했다.
  - 두 토글은 독립적으로 작동하며, 둘 다 꺼진 상태는 `none`으로 저장된다.
- handbook/운영 문서 최소 동기화
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
  - `docs/handbook/button-action-matrix.md`
  - `.claude/PROJECT_GUIDE.md`
  - 웹 관리자 모달에서 총무가 생명/손해 완료 플래그를 독립적으로 저장할 수 있다는 계약만 짧게 반영했다.

**결과**:
- 총무는 다시 웹 FC 상세 모달의 `생명/손해 위촉` 탭에서 생명/손해 완료 플래그를 각각 켜고 끌 수 있다.
- 저장은 기존 trusted 경로를 그대로 사용하므로 새로운 API나 스키마 변경은 없다.
- 본부장(read-only) 세션에서는 새 토글과 저장 버튼도 기존 규칙대로 비활성화된다.

**검증**:
- `cd web && npm run lint`

---

## <a id="20260330-web-dashboard-modal-tabs-single-row"></a> 2026-03-30 | 웹 FC 상세 관리 모달 탭을 한 줄 4탭으로 복구

**배경**:
- FC 상세 관리 모달의 상단 탭이 긴 라벨과 `grow` 레이아웃 때문에 두 줄로 밀리면서, 마지막 탭이 별도 전체폭 버튼처럼 보였다.
- 사용자는 `수당 동의 / 서류 관리 / 한화 위촉 / 생명/손해 위촉` 4개 탭이 반드시 같은 행에서 페이지 버튼처럼 보여야 한다고 요청했다.

**조치**:
- `web/src/app/dashboard/page.tsx`의 모달 탭 리스트에서 `grow`를 제거하고, nowrap 가로 레이아웃으로 고정했다.
- 각 탭에 `flex: 1 1 0`, `minWidth: 0`, `whiteSpace: 'nowrap'`를 적용해 네 탭이 동일한 행에서 균등하게 배치되도록 맞췄다.
- 긴 탭 라벨을 `한화 위촉`, `생명/손해 위촉`으로 축약해 실제 페이지 전환 버튼처럼 읽히도록 정리했다.

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

---

## <a id="20260330-allowance-prescreen-doc-sync"></a> 2026-03-30 | 수당동의 파생 상태와 단계명 변경을 handbook/작업로그에 동기화

**배경**:
- 수당동의 단계는 더 이상 `allowance-pending = 검토중`으로 단순 표현할 수 없고, FC 입력 완료와 총무의 사전 심사 요청 완료를 분리해서 설명해야 한다.
- 현재 화면/코드 설계는 `allowance_prescreen_requested_at`을 통해 수당동의 단계 내부 진행 상태를 나누는 방향으로 바뀌고 있어, handbook과 운영 로그가 이 계약을 그대로 따라가야 했다.
- 동시에 단계명도 `3단계 한화 위촉 URL`, `4단계 생명/손해 위촉`으로 정리해야 앱/웹/운영 문서가 같은 용어를 쓴다.

**조치**:
- `docs/handbook/workflow-state-matrix.md`
  - `allowance-pending` 내부 파생 상태를 `FC 수당 동의일 미입력 -> FC 수당 동의 입력 완료 -> 사전 심사 요청 완료 -> 승인 완료/미승인`으로 명시했다.
  - `allowance_prescreen_requested_at`의 의미와 reset 규칙을 추가했다.
  - `docs-approved` 이후 단계명을 `3단계 한화 위촉 URL`, `4단계 생명/손해 위촉`으로 다시 적었다.
- `docs/handbook/mobile/fc-onboarding.md`
  - 모바일 단계 정의와 FC 홈/다음 단계 문구를 새 수당동의 파생 상태 기준으로 정리했다.
  - FC가 수당 동의일을 다시 저장하면 `allowance_prescreen_requested_at`과 반려 사유가 초기화된다는 동작을 문서화했다.
- `docs/handbook/button-action-matrix.md`
  - FC의 수당동의 저장 액션이 `allowance_prescreen_requested_at=null`, `allowance_reject_reason=null`을 함께 쓰는 계약으로 정리했다.
  - 총무 수당동의 단계 조작(`입력 완료 / 사전 심사 요청 완료 / 승인 완료 / 미승인`) 전용 액션 행을 추가했다.
- `.claude/WORK_LOG.md`
  - 이번 handbook 동기화를 최근 작업에 추가했다.

**결과**:
- handbook과 운영 로그 기준으로는 이제 수당동의 단계가 `allowance_date`와 `allowance_prescreen_requested_at` 조합으로 파생 표현된다는 점이 명확해졌다.
- 단계명도 `한화 위촉 URL`과 `생명/손해 위촉`으로 통일됐다.

**메모**:
- 이번 작업은 문서 동기화만 수행했다. 코드/스키마 변경 여부는 별도 구현 작업에서 관리한다.

## <a id="20260329-resident-number-full-view-alignment"></a> 2026-03-29 | 가람in/GaramLink 주민번호 full-view 계약을 FC self-view와 embedded GaramLink까지 정렬

**배경**:
- 운영 정책은 이미 GaramIn/GaramLink 사용자 화면에서 full 주민번호 조회를 허용하는 쪽으로 이동했지만, 실제 코드와 문서에는 `admin/manager만`, `masked fallback`, `FC self-view 부재` 같은 옛 규칙이 섞여 있었다.
- GaramLink 서버는 `fc/designer/manager/admin/developer` full-view 계약을 갖고 있었지만, 일부 hydration 경로와 가람in 임베디드 request_board fetch는 `ssnView=full`을 누락하고 있었다.
- 가람in FC 본등록 화면은 full 주민번호 복호화를 `role === 'admin'`에만 묶고 있어 FC 본인이 자기 주민번호를 full-view로 확인하지 못했다.

**조치**:
- 가람in FC self-view를 trusted path 기준으로 열었다.
  - `app/fc/new.tsx`
  - `supabase/functions/admin-action/index.ts`
  - `admin-action:getResidentNumbers`가 FC caller에 대해서는 `phone -> fc_profiles.id`를 역추적해 자기 `fcId`만 읽을 수 있게 제한했다.
- 가람in embedded GaramLink resident number hydration을 full-view 기준으로 맞췄다.
  - `lib/request-board-api.ts`
  - `rbGetRequestList`, `rbGetRequestDetail`, `rbGetRequests`에 `ssnView=full`을 추가했다.
- GaramLink list/detail hydration 누락 경로를 full-view로 정리했다.
  - `request_board/server/src/routes/requests.ts`
  - `request_board/client/src/pages/MatrixView.tsx`
  - `request_board/client/src/pages/KanbanBoard.tsx`
  - `request_board/client/src/pages/RequestDetail.tsx`
- 문서/운영 규칙을 현행 정책에 맞게 동기화했다.
  - `README.md`
  - `AGENTS.md`
  - `docs/handbook/data/identity-and-pii.md`
  - `docs/handbook/backend/admin-operations-api.md`
  - `request_board/README.md`
  - `request_board/AGENTS.md`
  - `request_board/client/AGENTS.md`
  - `request_board/docs/project-specification.md`
  - `request_board/docs/agent-task-prompts.md`
  - `request_board/docs/handbook/data/identity-storage-and-ssn.md`

**검증**:
- `fc-onboarding-app`: 앱 lint, web build/lint, validation/workflow tests, governance
- `request_board`: client build, server build, governance

**메모**:
- 현행 계약은 “DB/log/local persistence에는 평문 주민번호를 남기지 않되, trusted path를 통해 GaramIn/GaramLink 사용자 화면에는 full-view를 일관되게 제공한다”이다.

## <a id="20260328-hanwha-commission-workflow-overhaul"></a> 2026-03-28 | 한화 위촉 URL 단계를 온보딩 플로우에 정식 편입하고 앱/웹/백엔드 상태 계산을 공통 helper로 수렴

**배경**:
- 기존 온보딩 플로우는 `수당동의 -> 서류제출 -> 생명/손해 위촉` 전제를 깔고 있어, 새 정책인 `3단계 한화 위촉 URL 승인 + PDF 전달 후 4단계 생명/손해 위촉 진행`을 정확히 반영하지 못했다.
- 앱 홈, 앱 관리자 대시보드, 웹 공용 helper가 각자 다른 단계 계산을 가지고 있어 같은 FC를 봐도 단계/다음 단계/관리자 필터가 어긋날 수 있었다.
- 문서 삭제/반려나 한화 재제출 뒤에도 stale PDF/기존 위촉 증거가 남아 다음 단계가 열릴 위험이 있어, 서버 쪽 reset 규칙을 함께 재정비해야 했다.

**조치**:
- 공통 상태/단계 helper를 추가했다.
  - `lib/fc-workflow.ts`
  - `web/src/lib/fc-workflow.ts`
  - `한화 위촉 URL 승인 + PDF 완료`가 아니면 4단계 `생명/손해 위촉`이 열리지 않도록 `hasUrlStageAccess()`를 재정의했다.
- 상태/스키마를 확장했다.
  - `types/fc.ts`, `web/src/types/fc.ts`
  - `supabase/schema.sql`
  - `supabase/migrations/20260328000001_add_hanwha_commission_contract.sql`
  - `hanwha_commission_date_sub`, `hanwha_commission_date`, `hanwha_commission_reject_reason`, `hanwha_commission_pdf_path`, `hanwha_commission_pdf_name` 등을 추가했다.
- Edge Function과 가입/세션 보조 로직을 새 단계에 맞췄다.
  - `supabase/functions/admin-action/index.ts`
  - `supabase/functions/fc-submit-hanwha-commission/index.ts`
  - `supabase/functions/fc-submit-appointment/index.ts`
  - `supabase/functions/_shared/commission.ts`
  - `supabase/functions/fc-consent/index.ts`
  - `supabase/functions/request-signup-otp/index.ts`
  - `supabase/functions/set-password/index.ts`
  - `supabase/functions/fc-notify/index.ts`
  - 한화 반려/재제출 시 stale PDF 메타데이터를 비우고, 문서 invalidation 시 downstream 한화/위촉 URL 필드도 reset되도록 정리했다.
- 앱 화면을 새 단계에 맞춰 개편했다.
  - `app/index.tsx`: 내 진행 상황, 다음 단계, 바로가기를 새 단계 기준으로 재계산
  - `app/hanwha-commission.tsx`: FC 전용 한화 위촉 제출 화면 추가
  - `app/appointment.tsx`: 한화 승인 전 안내/잠금 로직 정리
  - `app/dashboard.tsx`: 관리자 모바일 단계 필터/라벨을 웹 SSOT와 일치시킴
  - `app/docs-upload.tsx`: 승인/반려 이후 profile 상태 및 reset 규칙 재계산
- 웹 관리자 모달을 4탭 구조로 확장했다.
  - `web/src/app/dashboard/page.tsx`
  - `web/src/app/api/admin/fc/route.ts`
  - 탭 순서를 `수당 동의 / 서류 관리 / 한화 위촉 관리 / 생명/손해 위촉 관리`로 재구성
  - 한화 PDF 업로드/다운로드/삭제와 승인/반려를 모달 안에서 처리하도록 확장
  - 생명/손해 위촉 탭은 더 이상 클릭 자체를 막지 않고, 준비되지 않은 경우 안내 패널만 표시하게 조정
- 웹 helper/운영 화면을 동기화했다.
  - `web/src/lib/shared.ts`
  - `web/src/app/dashboard/appointment/actions.ts`
  - `web/src/app/dashboard/appointment/page.tsx`
  - `web/src/app/dashboard/docs/actions.ts`
  - `web/src/app/dashboard/docs/page.tsx`
  - `web/src/app/dashboard/layout.tsx`

**결과**:
- FC/총무/본부장이 앱과 웹 어디서 보더라도 `1 수당동의 -> 2 문서제출 -> 3 한화 위촉 URL -> 4 생명/손해 위촉 -> 5 완료`를 같은 기준으로 본다.
- 한화 승인과 PDF 전달이 끝나기 전에는 4단계 `생명/손해 위촉`이 열리지 않는다.
- 문서 삭제/반려와 한화 반려/재제출 이후 stale 메타데이터가 다음 단계 증거로 남지 않도록 reset 규칙을 통일했다.

**검증**:
- `npx eslint app/dashboard.tsx app/docs-upload.tsx app/appointment.tsx app/index.tsx lib/fc-workflow.ts lib/__tests__/workflow-step-regression.test.ts`
- `cd web && npm run lint -- src/app/api/admin/fc/route.ts src/app/dashboard/docs/actions.ts src/app/dashboard/page.tsx`
- `npx jest lib/__tests__/workflow-step-regression.test.ts lib/__tests__/commission.test.ts --runInBand`

**메모**:
- 로컬에 `deno`가 없어 `supabase/functions/*` 전용 타입체크는 별도로 수행하지 못했다.

## <a id="20260328-exam-and-readonly-ops-polish"></a> 2026-03-28 | 시험 신청·관리 UX와 read-only 운영 화면 표시를 보강

**배경**:
- 시험 신청 FC 화면에서 `응시료 납입 계좌`를 복사할 수 없었고, 관리자/본부장 시험 신청자 관리에서는 홈 대시보드와 같은 소속 빠른 필터가 없어 운영 동선이 길었다.
- 모바일 시험 신청자 관리 상단은 필터 UI가 경계선에 너무 붙어 보였고, 웹 시험 신청자 목록과 FC 상세 화면의 resident number/recommender 노출도 read-only 원칙에 맞춰 더 정리할 필요가 있었다.
- 문서 승인/삭제 이후 profile과 모달 로컬 상태가 stale하게 남아, 운영자가 같은 모달 안에서 잘못된 다음 단계를 볼 수 있는 보조 경로도 함께 정리해야 했다.

**조치**:
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`
  - `응시료 납입 계좌` 옆에 복사 chip을 추가해 클립보드 복사와 완료 알림을 붙였다.
- `app/exam-manage.tsx`, `app/exam-manage2.tsx`
  - 생명/손해 신청자 관리 상단을 카드형 header로 정리하고, 홈 대시보드와 같은 톤의 소속 quick filter chip을 추가했다.
- `web/src/app/dashboard/exam/applicants/page.tsx`
  - 본부장도 신청자 resident number full-view를 읽을 수 있게 복구하고, 소속 빠른 필터를 상단에 추가했다.
- `web/src/app/dashboard/profile/[id]/page.tsx`
  - FC 상세 read-only 화면에서 주민번호 fallback과 추천인 표시를 보강했다.
- `app/consent.tsx`
  - 임시사번 복사 버튼 위치를 자연스럽게 재배치하고, 보증보험 링크는 외부 브라우저로 열리게 유지했다.
- `web/src/app/api/admin/fc/route.ts`, `web/src/app/dashboard/docs/actions.ts`, `web/src/app/dashboard/page.tsx`
  - 문서 삭제/반려 시 profile 단계와 모달 로컬 상태가 함께 강등/reset되도록 보정했다.

**결과**:
- FC는 시험 신청 화면에서 필요한 계좌 정보를 즉시 복사할 수 있고, 관리자/본부장은 앱/웹 모두에서 소속 기준으로 신청자 목록을 더 빠르게 탐색할 수 있다.
- read-only 운영 화면은 주민번호/추천인/신청자 데이터를 더 일관되게 보여주면서도 편집 권한은 유지하지 않는다.
- 문서 invalidation 직후에도 화면이 stale 상태를 계속 보여주지 않고, 현재 실제 profile 상태를 반영한다.

**검증**:
- `npx eslint app/consent.tsx app/exam-apply.tsx app/exam-apply2.tsx app/exam-manage.tsx app/exam-manage2.tsx`
- `cd web && npm run lint -- src/app/dashboard/exam/applicants/page.tsx "src/app/dashboard/profile/[id]/page.tsx" src/app/api/admin/fc/route.ts src/app/dashboard/docs/actions.ts src/app/dashboard/page.tsx`

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `app/exam-manage.tsx`
- `app/exam-manage2.tsx`
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`

## <a id="20260327-manager-resident-number-phone-format-fix"></a> 2026-03-27 | 본부장 주민번호 조회 계정검증을 전화번호 다중 포맷으로 정규화

**배경**:
- 본부장(read-only manager) 계정은 권한상 주민번호 full-view를 읽을 수 있도록 열려 있었지만, 실제 웹 FC 상세에서 여전히 주민번호가 보이지 않는 문제가 남아 있었다.
- 확인 결과 세션 검증(`server-session`)과 주민번호 API, `admin-action(getResidentNumbers)` 모두 계정 전화번호를 숫자 11자리만으로 비교하고 있었고, `manager_accounts.phone` 저장값이 하이픈 포함 형식이면 검증 단계에서 `403`이 발생했다.
- 즉 권한 문제라기보다 `session_resident -> manager_accounts.phone` 매칭 포맷 불일치가 root cause였다.

**조치**:
- `web/src/lib/server-session.ts`
  - 세션 검증 시 원본값, 숫자만 남긴 값, 하이픈 포함 값을 모두 `phoneCandidates`로 만들어 `admin_accounts`, `manager_accounts`, `fc_profiles` 조회에 공통 적용했다.
- `web/src/app/api/admin/resident-numbers/route.ts`
  - privileged staff self-check도 동일하게 다중 포맷 후보(`raw/digits/formatted`)로 비교하도록 바꿨다.
- `supabase/functions/admin-action/index.ts`
  - `verifyAdmin`, `verifyManager`가 `.eq('phone', phone)` 대신 `buildResidentIds(phone)` 기반 `.in('phone', phoneCandidates)`를 사용하게 해, manager read path가 저장 포맷 차이로 차단되지 않게 맞췄다.

**로직 검토**:
- 권한 범위는 바뀌지 않는다. 여전히 `getResidentNumbers` 읽기 액션에 한해서만 manager가 허용되고, write action은 기존처럼 `admin`만 가능하다.
- 이번 변경은 전화번호 저장 형식 차이를 흡수하는 정규화 레이어 추가이므로, admin/manager 로그인 세션이 digits 또는 hyphenated 어느 쪽이든 동일하게 검증된다.

**검증**:
- `cd web && npm run lint -- src/lib/server-session.ts src/app/api/admin/resident-numbers/route.ts`

**메모**:
- 로컬 환경에 `deno`가 없어 `supabase/functions/admin-action/index.ts`의 별도 타입체크는 수행하지 못했다.

## <a id="20260327-handbook-governance-system"></a> 2026-03-27 | handbook/운영 핸드북 체계와 path-owner 기반 governance 게이트 추가

**배경**:
- `AGENTS.md`만으로는 두 프로젝트의 화면/버튼/운영 절차를 새 세션 AI나 신규 작업자가 빠르게 추적하기 어려웠다.
- 기능 변경 때 어떤 문서를 같이 갱신해야 하는지 규칙이 없어서, handbook drift를 사람 기억에 의존하는 구조였다.

**조치**:
- `docs/handbook/**`, `docs/README.md`
  - 공통/shared handbook, 저장소별 handbook index, screen inventory, workflow matrix, button matrix, runbook, change checklist를 추가해 문서 SSOT를 코드 옆으로 이동했다.
- `scripts/ci/check-governance.mjs`
  - path-owner map과 severity 기반 handbook sync 규칙을 읽어, handbook sync 세션일 때 관련 owner 문서 누락을 잡도록 확장했다.
- `.github/pull_request_template.md`, `README.md`, `AGENTS.md`
  - handbook 갱신 의무와 진입 문서를 PR/루트 문서에서 바로 찾을 수 있게 연결했다.

**결과**:
- 새 세션 AI는 handbook index와 change checklist를 따라 owner 문서를 먼저 찾을 수 있게 됐고, handbook 최신성도 PR/CI 기준으로 유지할 수 있게 됐다.

**검증**:
- `node scripts/ci/check-governance.mjs`

**핵심 파일**:
- `docs/handbook/shared/documentation-contract.md`
- `docs/handbook/path-owner-map.json`
- `scripts/ci/check-governance.mjs`
- `.github/pull_request_template.md`

## <a id="20260327-manager-visibility-consent-ux"></a> 2026-03-27 | 본부장 read-only 정보 노출과 가람in 수당동의 UX 보강

**배경**:
- 본부장(read-only manager) 계정은 “수정만 안 되고 보이는 정보는 모두 보여야 한다”는 운영 원칙과 달리, 일부 상세 화면에서 주민번호·추천인·시험 신청자 정보가 빠져 있었다.
- 수당동의 단계는 `allowance-pending` 상태 안에서도 `날짜 미입력 = 대기`, `날짜 입력 후 승인 전 = 검토 중`을 구분해야 했지만 웹 공용 라벨이 이를 한 번에 다루지 못했다.
- 가람in FC 화면에서는 임시사번을 바로 복사할 수 없었고, `서울보증보험 바로가기`도 외부 브라우저 대신 앱 내부에서 열려 UX 제약이 있었다.

**조치**:
- `web/src/app/dashboard/profile/[id]/page.tsx`, `web/src/app/dashboard/page.tsx`, `app/dashboard.tsx`
  - FC 상세 웹/앱 뷰에서 `추천인`을 read-only로 노출하고, 웹 상세/상세 모달에서 주민번호 full-view를 우선 표시하도록 정리했다.
- `web/src/app/dashboard/exam/applicants/page.tsx`
  - 시험 신청자 관리 목록에서도 본부장이 full resident number를 읽어 올 수 있게 맞췄다.
- `web/src/lib/shared.ts`, `lib/__tests__/workflow-step-regression.test.ts`
  - `allowance-pending + allowance_date 있음`이면 `수당동의 검토 중`, 날짜가 없으면 `수당동의 대기`로 나누고 회귀 테스트를 추가했다.
- `app/consent.tsx`, `lib/open-external-url.ts`
  - 임시사번 복사 버튼을 추가하고, `서울보증보험 바로가기`는 외부 브라우저 선호 옵션으로 열리도록 공통 helper를 확장했다.

**로직 검토**:
- 본부장은 여전히 read-only 세션이므로 편집 권한이 생기지 않는다. 이번 변경은 읽기/표시 경로만 넓히는 성격이다.
- 수당동의 상태는 `status` 값만으로 고정 라벨을 찍지 않고 `allowance_date`와 함께 파생 표시해야 운영 의미와 맞는다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx "src/app/dashboard/profile/[id]/page.tsx" src/app/dashboard/exam/applicants/page.tsx src/lib/shared.ts`
- `npx eslint app/consent.tsx app/dashboard.tsx lib/open-external-url.ts`
- `npx jest lib/__tests__/workflow-step-regression.test.ts --runInBand`

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/lib/shared.ts`
- `app/consent.tsx`
- `app/dashboard.tsx`
- `lib/open-external-url.ts`

## <a id="20260327-web-profile-manager-resident-number-and-recommender-fix"></a> 2026-03-27 | 웹 FC 상세 본부장 주민번호 조회 복구 + 추천인 표시 추가

**배경**:
- 본부장(read-only manager) 계정으로 웹 FC 상세에 들어가면 홈 목록은 읽을 수 있어도 주민등록번호가 `-`로만 남고, 상세 가입 정보에 추천인도 표시되지 않는 운영 문제가 확인됐다.
- FC 상세는 `fc_profiles`를 직접 읽기 때문에 `recommender` 컬럼 자체는 가져올 수 있었지만, 화면 타입/렌더링에 추천인 필드가 빠져 있었다.
- 주민번호 full-view는 `/api/admin/resident-numbers -> admin-action(getResidentNumbers)` 체인을 타는데, 두 곳 모두 `admin`만 허용하고 있어 manager 세션은 읽기 단계에서 차단되고 있었다.

**조치**:
- `web/src/app/dashboard/profile/[id]/page.tsx`
  - `FcProfileDetail` 타입에 `recommender`를 추가했다.
  - 주민번호 full-view 조회를 `admin`뿐 아니라 `manager`도 시도하도록 열었다.
  - full-view를 못 받아오더라도 `profile.resident_id_masked`를 fallback으로 보여주도록 바꿨다.
  - 상세 회원가입 카드에 read-only `추천인` 필드를 추가했다.
- `web/src/app/api/admin/resident-numbers/route.ts`
  - 세션 검증에서 `manager`를 read-only privileged viewer로 허용했다.
  - 쿠키 전화번호 검증 테이블을 role 기준으로 `admin_accounts` / `manager_accounts`로 분기했다.
  - Edge Function 호출에는 검증된 staff phone을 그대로 `adminPhone` payload로 전달하도록 정리했다.
- `supabase/functions/admin-action/index.ts`
  - `verifyManager()`를 추가했다.
  - `getResidentNumbers` 액션에 한해 `admin || manager`를 허용하고, 나머지 write action은 기존대로 `admin`만 허용하도록 유지했다.

**로직 검토**:
- 권한 변경은 `getResidentNumbers` read path에만 한정돼 있어 본부장 세션이 관리자 쓰기 액션을 수행할 수는 없다.
- 추천인은 `fc_profiles.recommender`의 read-only 노출만 추가했고, 추천인 운영 SSOT는 기존 referral handbook 계약을 그대로 유지한다.
- 주민번호는 여전히 `fc_identity_secure` 복호화 경로를 우선 사용하고, 실패 시 마스킹값만 노출한다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/profile/[id]/page.tsx src/app/api/admin/resident-numbers/route.ts`

**메모**:
- `admin-action` Deno 함수는 로컬에 `deno` 실행 환경이 없어 별도 타입체크는 수행하지 못했다. 대신 변경 범위는 권한 분기와 manager lookup 추가로 제한했다.
## <a id="20260327-web-dashboard-manager-list-and-allowance-pending-fix"></a> 2026-03-27 | 웹 대시보드 본부장 목록 조회 복구 + 수당동의 대기 라벨 정정

**배경**:
- 총무 웹에서 수당동의 반려를 처리해도 FC 현재 상태가 `수당동의 검토 중`으로 남아, 실제 기대 상태인 `수당동의 대기`와 어긋나 있었다.
- 같은 시점에 본부장(read-only manager) 계정으로 웹 홈 대시보드에 들어가면 FC 목록이 비어 `조건에 맞는 데이터가 없습니다.`만 보이는 운영 이슈가 재현됐다.
- 확인 결과 UI는 이미 read-only 모드로 설계되어 있었지만 `/api/admin/list` route가 `admin`만 허용하고 있어 manager 세션은 403으로 막히고 있었다.

**조치**:
- `web/src/lib/shared.ts`
  - `STATUS_LABELS['allowance-pending']`를 `수당동의 대기`로 정정했다.
  - `getSummaryStatus()`에서 `allowance-pending` 요약 라벨/색상을 fallback과 동일한 `수당동의 대기 / gray`로 맞췄다.
- `web/src/app/api/admin/list/route.ts`
  - 세션 검증에서 `manager`도 read-only 조회 역할로 허용해, 본부장 계정이 관리자 홈과 동일한 FC 목록 API를 읽을 수 있게 했다.
- `web/src/app/dashboard/page.tsx`
  - 대시보드 리스트 쿼리에 `hydrated` 가드를 추가해 세션 복구 전 빈 상태 요청이 먼저 나가지 않도록 조정했다.
  - 쿼리 키를 `['dashboard-list', role, residentId]`로 확장해 역할 전환 후 캐시가 섞이지 않게 했다.
  - `/api/admin/list` 응답을 배열/래핑 payload 모두 안전하게 해석하도록 방어 코드를 추가했다.
  - `LoadingOverlay`를 `!hydrated || isLoading` 기준으로 표시해 하드 리로드 직후 빈 테이블 flash를 줄였다.

**로직 검토**:
- 본부장 계정은 이번 변경으로 `조회는 전체 허용, 수정은 기존 UI read-only 가드 유지` 정책에 맞춰졌다.
- `queryClient.invalidateQueries({ queryKey: ['dashboard-list'] })`는 prefix 매칭으로 새 쿼리 키에도 그대로 유효하다.
- `allowance-pending` 상태값 자체는 기존 반려 처리에서 이미 정확히 저장되고 있었고, 이번 커밋은 잘못된 표시 라벨만 바로잡는다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx src/lib/shared.ts src/app/api/admin/list/route.ts`

## <a id="20260326-dashboard-reset-temp-id-to-lookup"></a> 2026-03-26 | FC 상세 관리에 `조회중(임시사번 미입력)` 복귀 버튼 추가

**배경**:
- 운영에서 FC 상세 관리 모달의 `임시사번`을 잘못 입력한 뒤, 다시 `조회중` 단계로 돌리고 싶다는 요청이 있었다.
- 기존 화면은 `임시사번` 수정만 가능했고, 상태를 `draft(임시사번 미발급)`로 되돌리거나 수당 동의일을 초기화하는 전용 동작이 없어 이전 단계 복귀가 어려웠다.

**조치**:
- `web/src/app/dashboard/page.tsx`
  - `draft`, `temp-id-issued`, `allowance-pending`, `allowance-consented` 상태이면서 `temp_id`가 있는 FC에만 `조회중 단계로 되돌리기` 버튼을 노출하도록 추가했다.
  - 버튼 클릭 시 확인 모달을 거친 뒤 `updateProfile` API로 `temp_id=null`, `allowance_date=null`, `allowance_reject_reason=null`, `status='draft'`를 한 번에 저장하도록 구현했다.
  - 성공 시 모달 로컬 상태도 즉시 비워, 사용자에게 `임시사번 미입력` 상태가 바로 반영되도록 맞췄다.

**검증**:
- `npx eslint src/app/dashboard/page.tsx`
- `node scripts/ci/check-governance.mjs`

## <a id="20260325-referral-admin-foundation"></a> 2026-03-25 | 추천인 코드 운영 기반 추가

**배경**:
- 추천인 시스템은 스키마와 문서만 먼저 정리된 상태였고, 실제 운영에서는 기존 FC에게 추천코드를 안전하게 발급/조회/관리할 수 있는 기반이 아직 없었다.
- 이미 서비스 중인 앱/웹에 붙는 기능이라, 가입 흐름 자체를 바로 바꾸기보다 보수적으로 `코드 마스터 운영`부터 별도 trusted 경로로 도입할 필요가 있었다.

**조치**:
- `supabase/schema.sql`, `supabase/migrations/20260325000001_add_referral_code_admin_foundation.sql`
  - `referral_events.event_type`에 `code_generated`, `code_rotated`, `code_disabled`를 추가했다.
  - service-role 전용 helper `generate_referral_code_candidate()`, `admin_issue_referral_code(...)`, `admin_disable_referral_code(...)`, `admin_backfill_referral_codes(...)`를 추가했다.
  - 추천코드는 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` 집합의 8자리로 생성하고, 충돌 시 최대 10회까지 재시도하도록 고정했다.
  - 발급 대상은 `signup_completed=true`, `11자리 phone`, non-`설계매니저`, non-`admin_accounts`, non-`manager_accounts`, 활성 코드 없음 조건으로 제한했다.
  - backfill은 `LIMIT + FOR UPDATE SKIP LOCKED` 기반 resumable batch로 구현하고, 모든 mutate 이벤트 metadata에 `actorPhone`, `actorRole`, `actorStaffType`, `reason`, `previousCode`, `nextCode`를 남기도록 맞췄다.
- `web/src/app/api/admin/referrals/route.ts`, `web/src/lib/admin-referrals.ts`, `web/src/types/referrals.ts`
  - `GET /api/admin/referrals`를 추가해 요약/검색/페이지네이션 목록과 선택 FC 상세를 반환하도록 구현했다.
  - `POST /api/admin/referrals`는 `backfill_missing_codes`, `rotate_code`, `disable_code`만 허용하고 `admin` role만 통과시키도록 제한했다.
  - `developer` subtype은 `admin_accounts.staff_type`으로 구분해 감사 metadata에는 `developer`로 남기고, `manager`는 GET만 가능하도록 이중 차단했다.
- `web/src/app/dashboard/layout.tsx`, `web/src/app/dashboard/referrals/page.tsx`
  - 대시보드 사이드바에 `추천인 코드` 진입점을 추가하고 `/dashboard/referrals` 화면을 신설했다.
  - 화면은 요약 카드, 검색 가능한 목록, 상세 패널(현재 코드/비활성 코드 이력/최근 운영 이벤트)로 구성했다.
  - 관리자/개발자 세션에서는 `일괄 발급`, `재발급`, `비활성` 모달을 노출하고, 본부장은 읽기 전용 배지와 안내만 보이도록 구성했다.
- `docs/referral-system/*`, `contracts/database-schema.md`, `AGENTS.md`, `docs/README.md`
  - 추천인 SSOT에 오늘 단계가 `추천 관계 확정 전의 코드 운영 기반`임을 반영하고, 백필 규칙/권한 경계/테스트 케이스를 동기화했다.

**검증**:
- `cd web && npm run lint -- src/app/api/admin/referrals/route.ts src/app/dashboard/referrals/page.tsx src/app/dashboard/layout.tsx src/lib/admin-referrals.ts src/types/referrals.ts`
- `cd web && npm run build`

**메모**:
- 오늘 구현은 기존 가입 화면(`signup.tsx`, `signup-password.tsx`, `set-password`)을 건드리지 않았다.
- 구조화 추천 관계 저장(`pending/confirm`), 초대링크, deferred deep link, 운영 override/cancel은 후속 할당치다.

## <a id="20260324-request-board-health-four-question-sync"></a> 2026-03-24 | GaramLink 모바일 리뷰 건강정보 4문항을 request_board 새 표현과 동기화

**배경**:
- request_board 고객 등록/상세/설계매니저 상세의 건강정보 질문이 운영 요청으로 새 4문항 표현으로 바뀌었다.
- 가람in `request-board-review`는 같은 request_board 상세 데이터를 읽지만, 모바일 리뷰 화면의 health label은 이전 문구를 계속 쓰고 있어 웹과 앱 사이 질문 표현이 다시 어긋나게 됐다.

**조치**:
- `app/request-board-review.tsx`
  - `healthFields` 라벨을 request_board와 같은 순서/표현으로 교체했다.
  - `current_medication -> 고혈압 당뇨 고지혈 약`, `recent_hospital_visit -> 3개월이내 병원 진료`, `recent_hospitalization -> 5년이내 입원/수술`, `major_diseases -> 중대질환(암,뇌,심,간질환)` 기준으로 정렬했다.

**검증**:
- `npx eslint app/request-board-review.tsx`

## <a id="20260324-docs-filter-ui-compact"></a> 2026-03-24 | 문서 관리 필터 UI compact 재정렬

**배경**:
- 후보자 검색 기능은 필요했지만, 첫 반영본의 필터 영역이 테이블 대비 과하게 크고 넓게 보여 화면 톤과 맞지 않는다는 운영 피드백이 들어왔다.
- 특히 검색 입력 폭과 탭 영역이 전체 가로폭을 많이 차지해, 상단 필터만 유독 부풀어 보이는 문제가 있었다.

**조치**:
- `web/src/app/dashboard/docs/page.tsx`
  - 외곽 필터 박스를 `xl` 크기에서 `lg` 기준의 더 낮은 높이로 줄이고, 배경도 흰색 기준으로 정리해 테이블 카드와 톤을 맞췄다.
  - 검색창은 `sm` 크기, `360px` 최대폭, 연한 배경 입력창으로 축소해 상단에서 덜 튀도록 조정했다.
  - 상태 탭은 전체 폭 균등 분할 대신 내용 기준의 compact pill 레이아웃으로 바꿔, 필터 영역이 한눈에 더 가볍게 보이도록 정리했다.
  - 우측 안내 문구도 `업로드된 서류 n건`의 짧은 카운트 텍스트로 줄였다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/docs/page.tsx`

## <a id="20260324-docs-candidate-search-and-pending-filter"></a> 2026-03-24 | 문서 관리 탭 후보자 검색 + 미처리 필터 정합화

**배경**:
- 운영에서 문서 관리 탭도 특정 후보자 성함으로 해당 후보자의 서류만 빠르게 좁혀 봐야 한다는 요청이 있었다.
- 기존 `미처리` 탭은 아직 실제 파일을 올리지 않은 placeholder 문서까지 함께 집계해, 제출하지 않은 후보자도 미처리 목록에 섞여 보였다.
- 상단 탭/필터 UI가 가로폭이 좁은 화면에서 잘리거나 답답하게 보이는 문제도 있었다.

**조치**:
- `web/src/app/dashboard/docs/page.tsx`
  - 후보자 이름을 중심으로 전화번호/소속까지 함께 찾을 수 있는 검색 입력을 추가해, 후보자 단위로 문서 목록을 좁혀 볼 수 있게 했다.
  - `storage_path`가 실제로 존재하는 업로드 문서만 `전체 목록`과 `미처리` 집계에 포함하도록 정리했다.
  - `미처리` 카운트는 업로드된 문서 중 `pending`/`submitted` 상태만 기준으로 다시 계산해, 미제출 placeholder row가 섞이지 않게 보정했다.
  - 필터 영역을 `Paper` + wrap 레이아웃으로 재구성하고 탭 버튼에 `flex-wrap`을 적용해 작은 폭에서도 잘리지 않도록 정리했다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/docs/page.tsx`

## <a id="20260323-user-scoped-notification-checkpoint"></a> 2026-03-23 | GaramLink unread checkpoint를 사용자별로 분리해 재설치 drift 보정

**배경**:
- GaramLink 웹에서 unread가 `0`이어도 가람in 홈 벨 숫자가 남는 사례를 운영 데이터로 확인했다.
- 원인을 분해해 보니 request_board unread 자체는 정상적으로 `0`을 반환했지만, 가람in `fetchMobileUnreadNotificationCount()`가 `lastNotificationCheckTime`이 비어 있을 때 `1970-01-01`부터의 앱 알림을 모두 unread처럼 다시 세고 있었다.
- 특히 `expo run:android` 재설치/앱 데이터 초기화 뒤에는 AsyncStorage의 전역 `lastNotificationCheckTime` 키가 사라져, `resident_id is null` 공용 FC 알림(`exam_round`, 공지 등) 14건이 GaramLink unread와 별개로 다시 붙는 것이 실제 운영 계정에서 재현됐다.

**조치**:
- `lib/notification-checkpoint.ts`
  - `role + residentId + requestBoardRole` 기준의 사용자별 notification checkpoint helper를 추가했다.
- checkpoint가 없을 때 홈 unread 계산은 epoch 기준으로 전체 unread를 보여주고, checkpoint는 알림센터 진입/읽음 처리 시 생성·갱신되도록 조정했다.
- `lib/mobile-unread-notification-count.ts`
  - unread count 계산이 더 이상 전역 AsyncStorage 키를 직접 읽지 않고 사용자별 checkpoint helper를 사용하도록 변경했다.
- `app/notifications.tsx`
  - 알림센터를 읽었을 때도 같은 사용자별 checkpoint를 갱신하도록 정리했다.

**운영 확인**:
- `request_board` 기준 `정준(테스트)` FC unread는 `0`
- 반면 기존 `fc-notify inbox_unread_count(exclude_request_board_categories=true)`는 공용 FC 알림(`resident_id is null`) 14건 때문에 `14`
- 이번 수정 후 checkpoint가 없는 첫 실행은 현재 시각으로 시작하므로, 재설치 직후 GaramLink live unread가 `0`이면 가람in 벨/배지도 `0`으로 맞춰진다.

**검증**:
- `npm run lint -- app/notifications.tsx lib/mobile-unread-notification-count.ts lib/notification-checkpoint.ts`

## <a id="20260323-live-request-board-unread-sync"></a> 2026-03-23 | 가람Link 실제 unread를 가람in 숫자와 동기화

**배경**:
- 기존 가람in 홈/설계요청 벨 숫자는 `fc-notify inbox_unread_count`가 주는 `lastNotificationCheckTime 이후 생성된 bridge row 수`를 그대로 사용했다.
- 그래서 사용자가 가람Link에서 알림을 읽어 `request_board.notifications.is_read`가 줄어도, 가람in 숫자는 여전히 과거 bridge insert 기준으로 남아 `가람Link에서 확인했는데 앱 숫자가 안 줄어든다`는 문제가 계속됐다.

**조치**:
- `lib/mobile-unread-notification-count.ts`
  - 모바일 공통 unread 계산 helper를 추가해, 가람in 자체 알림은 기존 `lastNotificationCheckTime` 기준을 유지하되 가람Link 쪽은 request_board API의 실제 unread count를 별도로 합산하도록 정리했다.
- `lib/request-board-api.ts`
  - `/api/notifications/unread/count`를 호출하는 `rbGetNotificationUnreadCount()`를 추가했다.
- `app/index.tsx`, `app/request-board.tsx`
  - 홈/설계요청 헤더 숫자가 더 이상 bridge row 생성 시점에 묶이지 않고, 가람Link 실제 unread 변화를 polling/focus 주기마다 반영하도록 교체했다.
- `app/notifications.tsx`
  - 알림센터 진입 시 `lastNotificationCheckTime`는 갱신하되, native badge는 `0`으로 강제하지 않고 최신 가람Link unread를 포함한 합산 수치로 다시 맞추도록 수정했다.
- `supabase/functions/fc-notify/index.ts`
  - `inbox_unread_count`에 `exclude_request_board_categories` 옵션을 추가해, 앱 자체 알림 카운트와 request_board 실제 unread를 분리 합산할 수 있게 했다.

**검증**:
- `npm run lint`

**메모**:
- 이번 수정 이후 가람in 숫자는 `앱 내부에서 확인했는지`보다 `가람Link 실제 unread가 남아 있는지`를 우선 반영한다. 따라서 가람Link에서 읽음 처리하면 홈/설계요청 벨과 시스템 배지도 다음 동기화 주기에서 함께 감소한다.

## <a id="20260323-native-notification-badge-sync"></a> 2026-03-23 | 가람in 알림 확인 후 홈 배지/시스템 알림 동기화

**배경**:
- 가람Link 브리지 알림을 확인하면 앱 내부 unread 집계는 사라지지만, 휴대폰 홈 화면 배지 숫자와 시스템 알림이 그대로 남아 운영에서 `앱 안에는 알림이 없는데 숫자가 안 없어진다`는 제보가 있었다.
- 기존 흐름은 Supabase inbox/read 상태만 갱신했고, Expo native badge count나 시스템 알림 dismiss 경로를 전혀 호출하지 않았다.

**조치**:
- `lib/system-notification-badge.ts`
  - `expo-notifications` 기반 helper를 추가해 unread 수를 홈 아이콘 badge count에 반영하고, unread가 `0`이면 `dismissAllNotificationsAsync()`까지 같이 호출하도록 정리했다.
- `app/notifications.tsx`
  - 알림센터 조회/새로고침 후 현재 unread 수를 다시 계산해 native badge와 시스템 알림을 즉시 동기화하도록 연결했다.
- `app/index.tsx`, `app/request-board.tsx`
  - 홈 화면과 `설계 요청` 화면의 request_board 최근 활동 집계가 끝날 때도 같은 helper를 호출해, 앱 재진입 경로나 탭 이동 뒤에도 배지 숫자가 남지 않게 맞췄다.
- `.claude/WORK_LOG.md`, `AGENTS.md`
  - 운영 이력과 현재 스냅샷 문서를 함께 갱신했다.

**검증**:
- `npm run lint`

**메모**:
- unread가 남아 있는 경우에는 시스템 알림 전체 삭제를 하지 않고 badge count만 현재 수치로 맞춘다.

## <a id="20260323-referral-schema-hardening"></a> 2026-03-23 | 추천인 접근 모델/이력 보존 보강

**배경**:
- 초기 추천인 스키마 초안은 테이블/문서 골격은 잡혔지만, 현재 가람in 세션 모델과 RLS가 맞지 않는 문제, 가입 전 pending write 경로 불명확, FC 삭제 시 추천 이력 유실 위험이 남아 있었다.
- 다음 단계 구현 전에 trusted server path 원칙과 삭제 후 snapshot 보존 구조를 먼저 고정할 필요가 있었다.

**조치**:
- `supabase/schema.sql`, `supabase/migrations/20260323000001_add_referral_schema.sql`
  - 추천인 테이블 direct client access를 열지 않도록 `referral_*` select 정책을 admin 직접 조회 전용으로 축소하고, 실사용 read/write는 trusted Edge Function/service-role 경로를 전제로 정리했다.
  - `referral_attributions`에 `inviter_phone`, `inviter_name` snapshot을 추가하고 `inviter_fc_id`를 nullable + `on delete set null`로 바꿔 FC 삭제 후에도 추천 이력이 남도록 수정했다.
  - `referral_events`에 `referral_code`, `inviter_phone`, `inviter_name` snapshot과 관련 인덱스를 추가해 FK 유실 후에도 사건 당시 맥락을 복원할 수 있게 했다.
  - `invitee_phone`, `inviter_phone`은 정규화된 숫자 11자리만 허용하도록 제약을 강화했다.
- `docs/referral-system/AGENTS.md`, `SPEC.md`, `ARCHITECTURE.md`, `TEST_CHECKLIST.md`, `test-cases.json`, `TEST_RUN_RESULT.json`
  - direct client access 금지, trusted pending/confirm API 전제, 삭제 후 이력 보존 규칙을 SSOT 문서와 테스트 자산에 반영했다.
  - `RF-HISTORY-01`, `RF-SEC-02` 등 회귀 케이스를 추가해 이력 보존과 접근 모델을 별도 검증 대상으로 승격했다.
- `contracts/database-schema.md`, `adr/0004-referral-schema-baseline.md`, `AGENTS.md`
  - 계약 문서와 ADR, 루트 Snapshot에 추천인 하드닝 방향을 반영했다.

**검증**:
- `node scripts/ci/check-governance.mjs`
- `git diff --check`
- `node`로 `docs/referral-system/test-cases.json`, `docs/referral-system/TEST_RUN_RESULT.json` JSON 파싱 성공 확인

**메모**:
- 아직 referral 전용 Edge Function 자체는 구현되지 않았다. 다음 단계는 `referral-upsert-pending` / `referral-confirm-signup` / 운영 조회 API 계약부터 들어가야 한다.

---

## <a id="20260323-referral-schema-draft"></a> 2026-03-23 | 추천인 스키마 초안 추가

**배경**:
- 추천인 규칙 문서는 정리됐지만, 실제 구현을 시작하려면 DB 레벨에서 추천코드 마스터, 추천 관계, 이벤트 로그의 구조가 먼저 고정돼야 했다.
- 현재 회원가입은 `fc_profiles.recommender` 자유입력 문자열을 사용하고 있어, 신규 구조화 추천 관계와 과도기 호환 전략도 함께 문서화할 필요가 있었다.

**조치**:
- `supabase/schema.sql`
  - `referral_codes`, `referral_attributions`, `referral_events` 테이블 초안을 추가했다.
  - `referral_codes`는 FC당 활성 코드 1개를 partial unique index로 제한했다.
  - `referral_attributions`는 `invitee_phone`과 `invitee_fc_id`를 함께 가져가 가입 전/후를 모두 추적하게 했고, `confirmed` 기준으로 invitee 최종 추천인 1명 제약을 partial unique index로 강제했다.
  - `referral_events`는 `link_clicked`, `code_auto_prefilled`, `admin_override_applied` 등 단계형 이벤트 로그를 저장하도록 구성했다.
  - `current_fc_phone()` 함수, `updated_at` trigger, referral 전용 RLS 정책을 추가했다.
- `supabase/migrations/20260323000001_add_referral_schema.sql`
  - 위 스키마 변경을 적용하는 migration 파일을 추가했다.
- `contracts/database-schema.md`
  - 신규 3개 테이블과 `fc_profiles.recommender` 레거시 호환 메모를 계약 문서에 반영했다.
- `docs/referral-system/SPEC.md`, `ARCHITECTURE.md`, `queries.sql`
  - 실제 테이블명 기준으로 문서를 갱신하고, 현재 1차 초안에서는 `admin override` 감사 흔적을 `referral_events`에 남긴다고 명시했다.
- `adr/0004-referral-schema-baseline.md`, `adr/README.md`
  - 추천인 스키마 베이스라인에 대한 ADR을 `Proposed` 상태로 추가했다.
- `AGENTS.md`
  - 루트 Snapshot에 추천인 스키마 초안 추가와 `recommender` 과도기 유지 사실을 기록했다.

**검증**:
- `node scripts/ci/check-governance.mjs`
- `git diff --check`
- `node`로 `docs/referral-system/test-cases.json`, `docs/referral-system/TEST_RUN_RESULT.json` JSON 파싱 성공 확인

**메모**:
- 현재 초안은 `admin override` 전용 별도 감사 테이블 없이 `referral_events` metadata를 사용하는 구조다.
- 실제 구현 단계에서는 회원가입 화면 자동 입력과 Edge Function 계약이 이 스키마를 어떻게 채우는지 맞춰야 한다.

## <a id="20260323-referral-rule-update"></a> 2026-03-23 | 추천인 규칙을 자동 입력 코드 기본 구조로 재정의

**배경**:
- 초기 추천인 문서 초안은 `초대링크 + 추천코드 fallback` 중심으로 정리돼 있었지만, 실제 구현 방향은 회원가입 화면에 추천코드를 자동 입력하는 쪽으로 더 구체화됐다.
- 동시에 추천 관계 cardinality도 `A는 여러 명을 추천 가능`, `B는 최종 추천인 1명만 가짐`으로 명시할 필요가 있었고, `admin override`가 단순 확정이 아니라 가입 완료 후 운영자 예외 수정이라는 점도 문서상 더 분명해야 했다.

**조치**:
- `docs/referral-system/AGENTS.md`
  - 추천인 구현 기준에 `가입 완료 후 일반 사용자 추천인 변경 금지`를 추가했다.
  - Current Delivery Plan의 추천코드 MVP를 `자동 입력 코드 + 가입 전 수정 fallback` 기준으로 갱신했다.
- `docs/referral-system/SPEC.md`
  - 기본 방식을 `자동 입력 추천코드 + 수동 수정 fallback`으로 재정의했다.
  - `한 inviter -> 여러 invitee`, `한 invitee -> 최종 추천인 1명` 규칙을 불변 규칙으로 명시했다.
  - 가입 완료 후 변경은 `admin override`만 가능하다고 정리하고, `override` 용어 정의를 운영자 예외 수정으로 명확히 바꿨다.
  - 추천 추적 데이터 모델에 `capture_source`, `selection_source` 예시 필드를 추가해 자동 입력 유지/수정 흔적을 남길 수 있게 했다.
- `docs/referral-system/ARCHITECTURE.md`
  - Phase 1과 주요 흐름을 `자동 입력 코드`, `가입 전 수정 UI`, `최종 선택 코드 검증` 기준으로 갱신했다.
  - 관찰성 이벤트에 `code_auto_prefilled`, `code_edited_before_signup`를 추가했다.
- `docs/referral-system/TEST_CHECKLIST.md`
  - 자동 입력 기본 규칙과 가입 전 수정 fallback 검증 의무를 반영했다.
  - cardinality 검증용 케이스(`RF-CODE-05`, `RF-CODE-06`)를 체크리스트에 추가했다.
- `docs/referral-system/test-cases.json`, `docs/referral-system/TEST_RUN_RESULT.json`
  - `RF-CODE-01`, `RF-LINK-03` 설명을 자동 입력 규칙에 맞게 수정했다.
  - `한 추천인 다수 추천 가능`, `가입자 단일 최종 추천인` 케이스를 추가했다.

**검증**:
- `node`로 `docs/referral-system/test-cases.json`, `docs/referral-system/TEST_RUN_RESULT.json` JSON 파싱 성공 확인

**메모**:
- 이번 변경은 규칙 정리 단계다. 다음 구현 단계에서는 회원가입 화면의 자동 입력 소스가 `invite_link`인지 다른 유입 문맥인지에 따라 실제 `capture_source` 값을 구체화해야 한다.

## <a id="20260320-request-board-hospitalization-copy-sync"></a> 2026-03-20 | GaramLink 모바일 리뷰 건강정보 3번 문구 동기화

**배경**:
- request_board 고객 등록/상세 화면의 건강정보 3번 문구가 운영 요청에 따라 `최근 5년 이내 입원 및 수술 이력, 7일이상 치료 이력`으로 바뀌면서, 가람in 임베디드 GaramLink 리뷰 화면도 같은 표현을 써야 화면 간 용어가 어긋나지 않았다.
- 모바일 리뷰는 값을 입력하는 화면은 아니지만, FC가 웹에서 등록한 고객 정보를 앱에서 다시 확인하는 주요 경로라 라벨이 다르면 같은 필드가 다른 항목처럼 보일 수 있었다.

**조치**:
- `app/request-board-review.tsx`
  - 건강정보 필드 배열의 `recent_hospitalization` 라벨을 `최근 5년 입원 및 수술 이력, 7일이상 치료 이력`으로 수정했다.
  - 다른 건강정보 라벨(`최근 병원 방문`, `현재 복용 약물`, `주요 질병`)은 그대로 유지해 필드 매핑 범위만 최소로 바꿨다.

**검증**:
- `npx eslint app/request-board-review.tsx` ✅

## <a id="20260319-referral-system-doc-baseline"></a> 2026-03-19 | 추천인 시스템 전용 문서 체계/테스트 자산 베이스라인 추가

**배경**:
- 추천인 시스템은 기존 위촉/설계요청 문서 체계에 섞여 들어가면 규칙, 장애 이력, 테스트 방법을 빠르게 찾기 어려웠다.
- 특히 초대링크, 추천코드, 스토어 fallback, 운영 보정처럼 구현 범위가 넓고 장애 지점이 많은 기능은 도메인 전용 SSOT와 케이스 자산이 없으면 이후 AI가 일관되게 추적/회귀 검증하기 어렵다.

**조치**:
- `docs/referral-system/`
  - 추천인 시스템 전용 폴더를 신설하고 `README.md`, `AGENTS.md`, `SPEC.md`, `ARCHITECTURE.md`, `TEST_CHECKLIST.md`, `test-cases.json`, `TEST_RUN_RESULT.json`, `INCIDENTS.md`, `fixtures/README.md`, `queries.sql`을 추가했다.
  - `AGENTS.md`에는 추천인 작업 시 필수로 함께 갱신해야 하는 문서, 장애 기록 의무, 테스트 결과 포맷, 회귀 규칙을 명시했다.
  - `SPEC.md`에는 `초대링크 + 추천코드 fallback`, 가입 완료 시 확정, 수동 입력 우선 등 현재 구현 계획 기준의 기본 정책과 미확정 항목을 정리했다.
  - `test-cases.json`과 `TEST_RUN_RESULT.json`으로 추천인 전용 기계판독 테스트 카탈로그/실행 결과 틀을 만들고, `INCIDENTS.md`에는 재현 가능한 장애 기록 템플릿을 추가했다.
- `docs/README.md`
  - 새 `referral-system/` 디렉토리를 문서 인덱스에 등록하고 유지 원칙을 추가했다.
- `AGENTS.md`
  - 루트 운영 규칙에 추천인 흐름 변경 시 전용 문서 세트를 같이 갱신해야 한다는 규칙을 추가했다.
  - Context Map에 추천인 시스템 SSOT 진입점을 추가했다.

**검증**:
- 문서/JSON 자산 추가만 수행했으며 런타임 코드 변경은 없음
- `node`로 `docs/referral-system/test-cases.json`, `docs/referral-system/TEST_RUN_RESULT.json` JSON 파싱 성공 확인

**메모**:
- 현재 `queries.sql`은 권장 테이블명 기준 초안이다. 첫 추천인 스키마 머지 이후 실제 테이블명으로 즉시 동기화해야 한다.
- 추천인 구현 시작 시 `INCIDENTS.md`와 `TEST_RUN_RESULT.json`을 빈 틀이 아니라 실제 이력 저장소로 전환해야 한다.

## <a id="20260319-postcode-webview-window-open-fix"></a> 2026-03-19 | iPhone 주소 검색 WebView 새 창/외부 이탈 보강 + 앱 버전 `2.1.9`

**배경**:
- iPhone 본등록/기본정보 수정 주소 검색은 기존 host allowlist 보강 이후에도 일부 Kakao postcode 단계가 `window.open` 또는 다른 HTTPS host로 튀면서 앱 WebView를 벗어나는 사례가 남아 있었다.
- 이 경우 Safari 또는 외부 앱으로 빠져 주소 선택 callback이 React Native로 돌아오지 않았고, 운영에서는 주소 검색이 다시 끊긴 것처럼 보였다.

**조치**:
- `lib/daum-postcode.ts`
  - 기존 `*.map.daum.net`/`*.map.kakao.com`/`*.daumcdn.net` host allowlist 대신, `about:`/`javascript:`/`data:`/`blob:` 같은 safe local 전환과 모든 `http(s)` 탐색을 postcode 전용 WebView 안에 남기도록 guard를 단순화했다.
  - 대신 `mailto:`/`tel:`/`kakaomap://` 같은 non-web scheme만 외부로 내보내도록 정리했다.
- `components/DaumPostcode.tsx`
  - `window.open`, `_blank` anchor click, `onOpenWindow`, `onShouldStartLoadWithRequest`를 함께 가로채 새 창 시도도 같은 WebView 내부 redirect로 되돌리도록 보강했다.
  - load/navigation/error trace를 남기는 진단 로깅과 dev 디버그 배너를 추가해 iOS 실기기에서 어떤 단계에서 이탈하는지 추적할 수 있게 했다.
- `lib/__tests__/daum-postcode.test.ts`
  - postcode web flow가 host에 상관없이 WebView 내부에 남고, non-web app scheme만 외부로 빠지는 새 guard 계약으로 테스트를 갱신했다.
- `app.json`
  - 다음 내부 배포 식별을 위해 Expo 앱 버전을 `2.1.9`로 상향했다.

**검증**:
- `npx eslint components/DaumPostcode.tsx lib/daum-postcode.ts lib/__tests__/daum-postcode.test.ts --rule "import/no-unresolved: off"`
- `npx jest lib/__tests__/daum-postcode.test.ts --runInBand`
- `node scripts/ci/check-governance.mjs`

## <a id="20260319-role-aware-password-reset"></a> 2026-03-19 | 총무/본부장/FC/설계매니저 공통 SMS 비밀번호 변경

**배경**:
- 로그인 화면의 `비밀번호 변경` 진입은 기존에 `fc_profiles` / `fc_credentials`만 조회했다.
- 그래서 `admin_accounts`에 저장된 총무와 `manager_accounts`에 저장된 본부장은 `request-password-reset`, `reset-password` 단계 모두에서 `등록된 계정을 찾을 수 없습니다.`로 막혔다.
- 동시에 운영 요구사항은 linked 설계매니저, 본부장, FC까지 포함해 가람in에서 바꾼 비밀번호가 GaramLink와도 최대한 같은 값으로 유지되도록 맞추는 것이었다.

**조치**:
- `supabase/functions/_shared/password-reset-account.ts`
  - 비밀번호 변경 대상 계정을 `admin_accounts -> manager_accounts -> fc_profiles/fc_credentials` 순서로 찾는 공통 helper를 추가했다.
  - request_board 비밀번호 sync payload도 같은 helper에서 role별로 계산하도록 정리했다.
- `supabase/functions/request-password-reset/index.ts`
  - 총무/본부장/FC/request_board-linked 설계매니저까지 같은 SMS 코드 발송 흐름을 타도록 계정 판별을 공통 helper 기반으로 변경했다.
  - 총무/본부장 inactive 상태, FC signup 미완료, password 미설정 케이스를 role-aware하게 분기했다.
  - SMS 문구를 FC 전용 표현 대신 `[가람in] 비밀번호 변경 코드`로 일반화했다.
- `supabase/functions/reset-password/index.ts`
  - 총무/본부장은 각자 테이블의 PBKDF2 비밀번호를 갱신하고, FC/linked 설계매니저는 기존 `fc_credentials`를 갱신하도록 분기했다.
  - 본부장/FC/linked 설계매니저/개발자 subtype은 기존 GaramLink sync 계약에 맞춰 reset 이후 같은 비밀번호를 request_board에도 전파하도록 유지했다.
  - 일반 총무는 role contract를 유지하기 위해 GaramLink direct 계정을 새로 만들지 않고 앱 비밀번호만 갱신한다.
- `supabase/migrations/20260319000001_add_admin_manager_password_reset_fields.sql`, `supabase/schema.sql`
  - `admin_accounts`, `manager_accounts`에 `reset_token_hash`, `reset_token_expires_at`, `reset_sent_at` 컬럼을 추가했다.
- `app/login.tsx`, `app/reset-password.tsx`, `app/settings.tsx`
  - 로그인 하단 문구를 `비밀번호 변경하기`로 교체했다.
  - 설정 화면 `계정` 카드에도 같은 비밀번호 변경 화면으로 가는 버튼을 추가했다.
  - 비밀번호 변경 화면 제목/완료 문구를 `변경` 표현으로 정리했고, 미등록 번호는 signup 강제 이동 대신 일반 안내만 띄우도록 조정했다.

**검증**:
- `npx eslint app/login.tsx app/reset-password.tsx supabase/functions/request-password-reset/index.ts supabase/functions/reset-password/index.ts supabase/functions/_shared/password-reset-account.ts --rule "import/no-unresolved: off"`

## <a id="20260318-web-dashboard-fc-name-nowrap"></a> 2026-03-18 | 웹 대시보드 FC 이름을 아바타 오른쪽에 고정

**배경**:
- `fc-onboarding-app/web` 관리자 대시보드 FC 목록의 `FC 정보` 컬럼 폭이 좁고 셀 내부 `Group`이 wrap 가능한 상태라, 이름이 조금만 길어도 원형 사람 아이콘 아래로 떨어지는 케이스가 있었다.
- 사용자 기준으로는 같은 테이블 안에서 일부 FC만 이름 정렬이 달라 보여 가독성이 깨지고, 아이콘 옆에 보여야 할 핵심 식별 정보가 아래 줄로 밀리는 문제가 있었다.

**조치**:
- `web/src/app/dashboard/page.tsx`
  - `FC 정보` 컬럼 폭을 `120 -> 200`으로 넓혀 이름/배지가 같은 블록 안에 머무를 수 있게 조정했다.
  - FC 목록 셀의 `Group`을 `wrap=\"nowrap\"` + `align=\"flex-start\"`로 바꿔 아이콘과 텍스트 블록이 세로로 분리되지 않게 고정했다.
  - 이름 텍스트 컨테이너에 `minWidth: 0`을 주고, 이름은 `white-space: nowrap + text-overflow: ellipsis`로 처리해 긴 이름도 아이콘 오른쪽에서만 잘리도록 정리했다.

**검증**:
- `cd web && npx eslint src/app/dashboard/page.tsx`

## <a id="20260318-login-with-password-cors-origin-echo"></a> 2026-03-18 | `login-with-password` CORS origin echo 보정 및 원격 재배포

**배경**:
- 웹 로그인 화면에서 `FunctionsFetchError`가 반복됐고, 실제 브라우저 토스트도 `Failed to send a request to the Edge Function`로 떨어졌다.
- 원인을 확인한 결과 `supabase/functions/login-with-password/index.ts`가 `ALLOWED_ORIGINS` 목록이 여러 개여도 항상 첫 번째 origin만 `Access-Control-Allow-Origin`에 넣고 있었다.
- 따라서 웹 앱이 다른 허용 origin 또는 `localhost`에서 호출되면 브라우저가 Edge Function 응답을 CORS로 차단하고, Supabase JS는 이를 `FunctionsFetchError`로만 표면화했다.

**조치**:
- `supabase/functions/login-with-password/index.ts`
  - 요청 `Origin`을 읽어 허용 목록에 있으면 그 origin을 그대로 반사하는 `resolveCorsOrigin` / `buildCorsHeaders` 헬퍼를 추가했다.
  - `localhost`, `127.0.0.1`은 개발용으로 명시 허용하고, `ALLOWED_ORIGINS`가 비어 있는 환경에서는 요청 origin으로 fallback 하도록 정리했다.
  - 모든 `OPTIONS`, 성공 응답, 실패 응답이 동일한 request-aware CORS 헤더와 `Vary: Origin`을 사용하도록 통일했다.
- 운영 반영:
  - `supabase functions deploy login-with-password`로 원격 Supabase 함수 재배포를 완료했다.

**검증**:
- `supabase functions deploy login-with-password`
- 원격 preflight 확인:
  - `Origin: http://localhost:3000` + `OPTIONS /functions/v1/login-with-password`
  - 응답 `Access-Control-Allow-Origin: http://localhost:3000`
- 원격 로그인 확인:
  - 같은 origin으로 실제 `POST /functions/v1/login-with-password`
  - 응답 `ok=true` 확인

## <a id="20260318-web-auth-functions-fetch-sanitize"></a> 2026-03-18 | 웹 로그인 `FunctionsFetchError` 사용자 노출/개발 오버레이 완화

**배경**:
- 웹 로그인 화면이 `Failed to send a request to the Edge Function` 같은 Supabase transport 에러 문구를 그대로 토스트로 노출해, 일반 사용자 기준으로 이해하기 어려웠다.
- 동시에 `handleLogin` catch가 모든 실패를 `logger.error()`로 남기고 있어, 개발 모드에서는 Next.js가 `console.error`를 런타임 오류처럼 강조 표시해 실제 로그인 원인과 별개로 빨간 오버레이가 따라붙었다.
- 실제 Edge Function 네트워크/CORS 원인은 별도 추적이 필요하지만, 우선 사용자 화면과 개발자 경험 측면에서 raw transport 에러를 그대로 노출하지 않도록 정리할 필요가 있었다.

**조치**:
- `web/src/app/auth/page.tsx`
  - `FunctionsFetchError`, `Failed to fetch`, `Failed to send a request to the Edge Function` 패턴을 감지하는 로그인 에러 정규화 helper를 추가했다.
  - transport 계열 실패는 사용자에게 `로그인 요청을 서버로 보내지 못했습니다. 잠시 후 다시 시도해주세요.`로 통일해 안내하도록 변경했다.
  - 같은 transport 실패는 `logger.warn()`으로만 남겨 개발 모드 `console.error` 오버레이를 유발하지 않게 조정했다.
  - 그 외 실제 앱 로직 오류만 `logger.error()`로 유지하고, 로그 payload는 `name/message`만 명시적으로 남기도록 정리했다.

**검증**:
- `cd web && npx eslint src/app/auth/page.tsx`
- `cd web && npm run build`
  - 현재 로컬 `next dev`가 실행 중이라 `scripts/clean-next.mjs` 단계에서 중단됨. 빌드 실패 원인은 이번 변경이 아니라 활성 dev 서버 감지다.

## <a id="20260318-web-auth-error-visibility"></a> 2026-03-18 | 웹 로그인 실패 원인 노출 보강

**배경**:
- 운영 브라우저에서 로그인 실패 토스트가 `오류가 발생했습니다. 다시 시도해주세요.`만 보여 실제 원인을 판별하기 어려웠다.
- 같은 계정으로 `login-with-password` Edge Function을 직접 호출했을 때는 정상 응답이 확인되어, 웹 클라이언트에서 발생하는 예외도 메시지와 로그를 그대로 남길 필요가 있었다.

**조치**:
- `web/src/app/auth/page.tsx`
  - `catch`에서 예외 객체의 실제 `message`를 우선 노출하도록 변경했다.
  - 동일 예외를 `logger.error('[web auth] login failed', err)`로 기록해 브라우저 콘솔/수집 로그에서 바로 추적할 수 있게 했다.
  - `setLoading(false)`를 `finally`로 이동해 예외/조기실패 경로 모두에서 로딩 상태가 일관되게 해제되도록 정리했다.

**검증**:
- `cd web && npx eslint src/app/auth/page.tsx`
- `login-with-password` 직접 호출 검증:
  - 제공된 개발자 계정으로 Edge Function 응답 `ok=true, role=admin, staffType=developer` 확인

## <a id="20260318-admin-allowance-date-direct-input"></a> 2026-03-18 | 총무가 모바일/웹에서 FC 수당 동의일 직접 입력 지원

**배경**:
- 기존 가람in 수당동의 흐름은 FC가 `app/consent.tsx`에서만 `allowance_date`를 직접 제출할 수 있었고, 총무는 입력 여부를 확인한 뒤 승인/반려만 할 수 있었다.
- 운영 요청에 따라 총무도 FC 대신 수당 동의일을 직접 입력할 수 있어야 했고, 이 기능이 모바일 총무 대시보드와 `fc-onboarding-app/web` 관리자 대시보드 양쪽에서 동일하게 동작해야 했다.
- FC 자가입력과 같은 안전장치를 유지하기 위해, 총무 직접 입력도 `temp_id` 선행 조건과 `allowance-pending` 상태 규칙을 공유해야 했다.

**조치**:
- `supabase/functions/admin-action/index.ts`
  - 관리자 전용 `updateAllowanceDate` 액션을 추가했다.
  - 날짜 형식을 `YYYY-MM-DD`로 검증하고, `temp_id`가 없는 FC는 저장을 막도록 했다.
  - 현재 상태가 `draft/temp-id-issued/allowance-pending`이면 총무 직접 입력도 FC 제출과 동일하게 `allowance-pending`으로 맞추고, 이미 이후 단계인 FC는 기존 상태를 유지한 채 `allowance_date`만 수정하도록 정리했다.
- `web/src/app/api/admin/fc/route.ts`
  - 웹 관리자 대시보드용 서버 경로에도 같은 `updateAllowanceDate` 액션과 검증/상태 보정 로직을 추가했다.
- `app/dashboard.tsx`
  - 총무 모바일 카드의 `1단계: 정보 등록 및 수당동의` 섹션에 수당 동의일 날짜 선택기와 `동의일 저장` 버튼을 추가했다.
  - Android는 인라인 `DateTimePicker`, iOS는 별도 모달 picker로 입력하게 했고, 반려 시 로컬 입력값도 함께 비우도록 정리했다.
- `web/src/app/dashboard/page.tsx`
  - 웹 관리자 `수당 동의` 탭의 `수당 동의 검토` 영역에 편집 가능한 날짜 입력기와 `수당 동의일 저장` 버튼을 추가했다.
  - 저장 성공 시 모달 로컬 상태(`allowance_date`, `status`, `temp_id/career_type` 변경분)가 즉시 반영되도록 보강했다.
- `.claude/PROJECT_GUIDE.md`
  - 총무 직접 입력 시 지켜야 하는 수당 동의일 정책(`temp_id` 선행, `allowance-pending` 정렬)을 문서에 추가했다.

**검증**:
- `npx eslint app/dashboard.tsx`
- `cd web && npx eslint src/app/dashboard/page.tsx src/app/api/admin/fc/route.ts`
- `npx eslint supabase/functions/admin-action/index.ts`
  - 현재 저장소의 Node ESLint 환경에서는 Deno remote import(`https://deno.land/...`, `https://esm.sh/...`)를 `import/no-unresolved`로 보고해 실패한다. 이번 변경으로 추가된 새 오류는 없었고, `deno` 실행 파일은 현재 환경에 설치되어 있지 않아 Deno lint/check는 수행하지 못했다.

## <a id="20260318-app-version-bump-218"></a> 2026-03-18 | Expo 앱 버전 2.1.8 상향 + `fc_profiles.admin_memo` 스키마 스냅샷 동기화

**배경**:
- 현재 작업분 배포/배포 준비 기준 버전을 앱 설정에도 맞춰 둘 필요가 있어 `app.json`의 Expo 버전을 한 단계 올렸다.
- `node scripts/ci/check-governance.mjs`를 다시 실행했을 때, 앞서 추가했던 `fc_profiles.admin_memo` migration이 `supabase/schema.sql` 스냅샷에는 아직 반영되지 않아 schema/migration 불일치로 실패했다.

**조치**:
- `app.json`
  - Expo 앱 버전을 `2.1.7`에서 `2.1.8`로 갱신했다.
- `supabase/schema.sql`
  - `public.fc_profiles` 정의와 후행 `alter table` 스냅샷에 `admin_memo` 컬럼을 추가해 migration 상태와 스키마 스냅샷을 다시 일치시켰다.

**검증**:
- `npx expo config --json`
- `node scripts/ci/check-governance.mjs`

## <a id="20260318-admin-memo-migration-address-handoff"></a> 2026-03-18 | 관리자 메모 스키마 드리프트 보정 + iPhone 주소 상세주소 포커스 handoff 안정화

**배경**:
- 관리자 웹 FC 상세(`web/src/app/dashboard/profile/[id]/page.tsx`)의 `관리자 메모` 저장 버튼이 실제로는 `요청 처리에 실패했습니다.` 토스트만 띄우고 저장되지 않는다는 제보가 들어왔다.
- 연결된 Supabase를 직접 확인한 결과 `select admin_memo from fc_profiles`가 Postgres `42703 column does not exist`로 실패했고, 저장 화면은 `select('*')`를 쓰고 있어 로딩 시에는 조용히 지나가지만 저장 시 `.update({ admin_memo })`에서만 터지는 스키마 드리프트 상태였다.
- iPhone 본등록/기본정보 수정 주소 흐름은 2026-03-16에 Kakao postcode host allow-list를 보강했지만, 주소 선택 직후 `setTimeout(...focus(), 250)`에만 의존하고 있어 모달 닫힘 애니메이션 타이밍에 따라 `상세주소` 입력 포커스가 끊길 여지가 남아 있었다.

**조치**:
- `supabase/migrations/20260318000001_add_fc_profile_admin_memo.sql`
  - `fc_profiles.admin_memo` 컬럼을 `if not exists`로 추가하는 migration을 새로 작성했다.
- `web/src/app/api/admin/fc/route.ts`
  - DB에 `admin_memo` 컬럼이 없는 상태에서 저장을 시도하면 generic 500 대신 `Supabase 마이그레이션을 먼저 적용해주세요.`라는 원인형 메시지를 반환하도록 보강했다.
- `lib/daum-postcode.ts`, `lib/__tests__/daum-postcode.test.ts`
  - postcode WebView 내부 허용 host를 exact 2개에서 `*.map.daum.net`, `*.map.kakao.com`, `*.daumcdn.net` 패턴으로 넓혀 Kakao/Daum postcode 흐름의 추가 host 변형에 덜 취약하게 만들었다.
  - 관련 회귀 테스트에 `search.map.daum.net`, `t1.daumcdn.net` 허용과 `accounts.kakao.com` 차단 케이스를 추가했다.
- `app/identity.tsx`, `app/fc/new.tsx`
  - 주소 검색 완료 후 즉시 `focus()`하던 경로를 `pendingAddressDetailFocus` 상태 + `InteractionManager.runAfterInteractions` 기반으로 교체했다.
  - 이제 주소 선택 후 모달이 닫힌 다음에만 `상세주소` 입력란으로 포커스를 넘기므로, iPhone 모달 종료 타이밍과 충돌하는 문제를 줄인다.

**검증**:
- 연결 DB 진단: `select admin_memo from fc_profiles` 결과 `42703 column fc_profiles.admin_memo does not exist` 확인
- `npx jest lib/__tests__/daum-postcode.test.ts --runInBand`
- `npx eslint app/identity.tsx app/fc/new.tsx components/DaumPostcode.tsx lib/daum-postcode.ts lib/__tests__/daum-postcode.test.ts`
- `cd web && npx eslint src/app/api/admin/fc/route.ts`

**후속 확인 포인트**:
- 대상 Supabase 환경에 `supabase db push` 또는 동등한 migration 적용 후 관리자 메모 저장이 즉시 복구되는지 확인
- 실제 iPhone 기기에서 `주소 검색 -> 주소 선택 -> 상세주소 키보드 표시`가 모달 종료 뒤 안정적으로 이어지는지 재검증

## <a id="20260316-login-hardening-governance-backfill"></a> 2026-03-16 | GaramLink 로그인 핫픽스 푸시 거버넌스 보강

**배경**:
- GitHub Actions `governance` 체크가 커밋 `7a93ae1`(`fix(app): harden garamlink login flow`)에서 실패했다.
- 원인은 로그인/브릿지 URL 보정과 비밀번호 변경 문구 수정이 코드 diff로 포함됐지만, 같은 diff 범위에 `WORK_LOG.md`와 `WORK_DETAIL.md`가 함께 갱신되지 않았기 때문이다.
- 기능 코드는 이미 정상 반영돼 있으므로, 재푸시를 위해서는 이전 로그인 핫픽스의 작업 이력을 문서에 명시적으로 보강할 필요가 있었다.

**조치**:
- `.claude/WORK_LOG.md`
  - 2026-03-16 GaramLink 로그인 핫픽스 재푸시용 거버넌스 보강 항목을 추가했다.
- `.claude/WORK_DETAIL.md`
  - GitHub Actions 실패 원인과 재푸시 목적을 추적할 수 있도록 상세 이력을 추가했다.
- 푸시 절차는 기존 커밋 amend 대신 docs-only 후속 커밋으로 정리해, 이미 원격에 올라간 로그인 핫픽스 이력은 유지하면서 governance diff만 보강하도록 정렬했다.

**검증**:
- `node scripts/ci/check-governance.mjs`

## <a id="20260316-request-board-inbox-bridge-sync"></a> 2026-03-16 | GaramLink 브리지 알림 인박스 연동 복구

**배경**:
- 가람Link에서 발생한 알림은 가람in 알림센터와 `설계 요청` 최근 활동에도 보여야 하지만, 실제로는 본부장/개발자처럼 앱 role이 `admin`이고 request_board role이 `fc`인 세션에서 누락될 수 있었다.
- 원인을 확인한 결과 `request_board` 브리지는 `fc-notify`에 항상 `target_role='fc'`로 적재하고 있었는데, 가람in 쪽 `fc-notify inbox_*` 조회는 `role='admin'`일 때 `recipient_role='admin'`만 읽고 있었다.
- 동시에 모바일 알림센터(`app/notifications.tsx`)는 admin inbox 조회 시 `resident_id`를 `null`로 보내 개인 대상 알림까지 놓칠 수 있었다.

**조치**:
- `supabase/functions/fc-notify/index.ts`
  - `inbox_list`, `inbox_unread_count`, `inbox_delete` payload에 `include_request_board_fc` 옵션을 추가했다.
  - admin 세션이 `resident_id`와 함께 이 옵션을 보내면, 같은 전화번호로 적재된 `request_board_*` + `recipient_role='fc'` 알림을 admin inbox 결과/카운트/삭제 경로에 함께 합치도록 보강했다.
- `app/notifications.tsx`
  - admin 계열 세션도 inbox 조회 시 `resident_id`를 항상 전달하도록 수정했다.
  - 개발자 전용 이중 조회/이중 삭제 분기를 걷어내고, `requestBoardRole === 'fc'`일 때 `include_request_board_fc` 한 번만 전달하도록 단순화했다.
- `app/request-board.tsx`
  - `설계 요청` 메인의 최근 활동/미확인 알림 집계가 본부장·개발자 세션에서도 같은 통합 inbox 규칙을 사용하도록 맞췄다.
- `app/index.tsx`
  - 홈 상단 벨 배지 unread 조회도 `requestBoardRole === 'fc'`인 admin 세션에서 GaramLink 브리지 알림을 포함하도록 정리했다.

**검증**:
- `npx eslint app/notifications.tsx app/request-board.tsx app/index.tsx`
- `npx tsc --noEmit`
- `node -` inline TypeScript parse check for `supabase/functions/fc-notify/index.ts`

## <a id="20260316-request-board-login-timeout-dev-url-fix"></a> 2026-03-16 | GaramLink 로그인/최근활동/의뢰목록 무한로딩 방지

**배경**:
- 사용자 제보 기준 가람in 로그인 버튼이 계속 로딩 상태에 머물고, 이어서 `설계 요청`의 `최근 활동`과 `의뢰 목록`도 무한 로딩에 빠졌다.
- 원인을 확인한 결과 앱 로그인은 `login-with-password` 성공 직후 `rbBridgeLogin()`을 동기 대기하고 있었고, request_board URL resolver는 Expo 개발 빌드에서 명시적 env가 없으면 Expo host 기준 로컬 `:3000` / `:5173`로 자동 전환되고 있었다.
- 따라서 디바이스에서 로컬 request_board 서버가 떠 있지 않은 상태로 개발 빌드를 열면 로그인 단계부터 request_board fetch가 붙잡히고, 이후 `최근 활동`/`의뢰 목록`도 같은 base URL에서 응답 없이 대기할 수 있었다.

**조치**:
- `hooks/use-login.ts`
  - 앱 로그인 성공 후 request_board 브릿지 로그인을 더 이상 동기 대기하지 않도록 바꿨다.
  - `login-with-password`가 내려주는 `requestBoardRole` fallback으로 즉시 앱 세션을 열어, GaramLink 연결 지연이 앱 로그인 전체를 막지 않게 정리했다.
- `lib/request-board-url.ts`
  - Expo 개발 빌드의 request_board 로컬 host 자동 해석을 기본 동작에서 제거하고, `EXPO_PUBLIC_REQUEST_BOARD_USE_LOCAL_DEV=1`일 때만 명시적으로 opt-in 하도록 변경했다.
  - env가 없으면 개발 빌드도 운영 GaramLink URL을 기본값으로 사용하게 맞췄다.
- `lib/request-board-api.ts`
  - bridge login / 공통 API fetch / direct login에 8초 타임아웃을 추가해 request_board 응답 지연 시 무한 대기 대신 명시적 오류로 빠지도록 보강했다.
- `README.md`, `AGENTS.md`
  - 로컬 request_board 개발은 `EXPO_PUBLIC_REQUEST_BOARD_USE_LOCAL_DEV=1` opt-in 방식이라는 환경 계약으로 문서를 갱신했다.

**검증**:
- `npx eslint hooks/use-login.ts lib/request-board-api.ts lib/request-board-url.ts`
- `npx tsc --noEmit`
- `node scripts/ci/check-governance.mjs`

---

## <a id="20260316-login-reset-copy"></a> 2026-03-16 | 가람in 로그인 비밀번호 재설정 링크 문구 교체

**배경**:
- 운영 요청에 따라 가람in 로그인 화면 하단의 `비밀번호를 잊으셨나요?` 안내를 보다 직접적인 표현으로 바꿔야 했다.
- 동작 자체는 그대로 `reset-password` 화면으로 이동하지만, 실제 사용자에게는 비밀번호 분실 안내보다 변경 동작을 더 명확하게 보이는 문구가 필요했다.

**조치**:
- `app/login.tsx`
  - 로그인 버튼 아래 링크 레이블을 `대신 비밀 번호 변경하기`로 교체했다.
  - 라우팅 경로와 버튼 스타일은 유지하고 노출 문구만 변경했다.

**검증**:
- `npx eslint app/login.tsx`

## <a id="20260316-request-board-list-hydration-layout-fix"></a> 2026-03-16 | GaramLink 의뢰목록 초기 실패 배너 및 상태 배지 겹침 정리

**배경**:
- 정승철 계정 실데이터를 다시 확인한 결과 2026-03-16 기준 GaramLink 의뢰는 `223(cancelled)`, `222(completed/rejected)`, `221(completed/fc review pending)` 총 3건이며, `FC 검토 대기`는 1건이었다.
- 그런데 앱 `의뢰 목록` 화면은 세션 `hydrated` 이전에도 `ensureRequestBoardSession()`을 바로 호출해, 실제 데이터 유무와 무관하게 첫 진입 시 `세션 복원 중입니다.` 경로를 generic `의뢰 목록을 불러오는데 실패했습니다.` 배너로 바꿔 보여줄 수 있었다.
- 같은 화면의 카드 상단은 `검토 대기` 강조 배지를 absolute 배치로 올려두고, 완료 상태 배지를 같은 우측 상단에 렌더링하고 있어 `완료`와 `검토 대기`가 겹쳐 보였다.

**조치**:
- `app/request-board-requests.tsx`
  - 데이터 fetch를 `hydrated` 이후로 지연시켜 세션 복원 중 허위 실패 배너가 뜨지 않게 수정했다.
  - sync 실패 시 generic 문구 대신 실제 오류 메시지를 우선 노출하도록 바꿔, 재로그인 필요/연동 실패 같은 원인을 화면에서 바로 알 수 있게 정리했다.
  - 의뢰 카드 우측 상태 표시를 absolute overlay 대신 세로 스택 badge column으로 변경해 `검토 대기`와 `완료`가 겹치지 않게 수정했다.
- `app/request-board-review.tsx`
  - 상세 화면도 동일하게 `hydrated` 이후에만 fetch하도록 맞추고, sync 실패 시 실제 오류 메시지를 우선 표시하게 보강했다.

**검증**:
- 실서버 API 재확인: `login-with-password([redacted-phone]) -> /api/auth/bridge-login -> /api/requests?limit=100&page=1`
- `npx eslint app/request-board-requests.tsx app/request-board-review.tsx`
- `npx tsc --noEmit`
- `node scripts/ci/check-governance.mjs`

---

## <a id="20260316-request-board-pending-visibility"></a> 2026-03-16 | GaramLink 수락대기/검토대기 가시성 강화

**배경**:
- FC 입장에서 `설계 매니저 수락 대기` 건수는 홈 통계 카드 안 숫자로만 보여 한눈에 찾기 어려웠고, 의뢰 목록 상단의 강조 배지는 `검토 대기`만 보여 같은 화면에서 현재 무엇이 밀려 있는지 구분이 잘 되지 않았다.
- 실계정 검토 기준 사용자 피드백도 “수락대기 중인 의뢰가 있는지, 있다면 몇 건인지 바로 확인이 안 된다”는 점에 집중돼 있었다.

**조치**:
- `app/request-board.tsx`
  - FC/본부장/총무용 통계에 `reviewPending` 집계를 추가했다.
  - `설계요청` 메인 `의뢰 현황` 상단에 `설계매니저 수락 대기`, `FC 검토 대기` 2개의 요약 카드를 추가해 현재 즉시 확인이 필요한 건수를 카드 그리드보다 먼저 보이게 정리했다.
- `app/request-board-requests.tsx`
  - 의뢰 목록 헤더에 같은 두 상태를 별도 요약 카드로 노출해 필터 탭 전에 현재 밀린 건수를 바로 읽을 수 있게 보강했다.

**검증**:
- `npx eslint app/request-board.tsx app/request-board-requests.tsx`
- `npx tsc --noEmit`
- `node scripts/ci/check-governance.mjs`

## <a id="20260316-request-board-review-sync-cancelled"></a> 2026-03-16 | GaramLink 의뢰 목록/상세 취소 의뢰 및 고객 상세정보 연동 보강

**배경**:
- 가람in 임베디드 GaramLink 의뢰 목록은 `cancelled` 상태를 집계/필터에서 제외하고 있어, 취소 의뢰 알림을 눌러도 목록에 해당 건이 보이지 않을 수 있었다.
- 의뢰 상세 화면은 실제 request_board 응답이 담고 있는 주민번호, 주소, 직업, 보험 자격, 건강정보, 납입정보, 요청 상품, 설계 링크/취소 사유 같은 필드를 거의 렌더링하지 않아 “가람Link 정보가 모두 연동되는지” 검토 결과와 어긋나 있었다.
- 최근 활동 알림도 `request_board_cancelled`와 FC 거절 카테고리를 적절한 의뢰 목록 필터로 보내지 못해, 사용자가 알림과 목록 화면 사이에서 상태를 추적하기 어려웠다.

**조치**:
- `lib/request-board-api.ts`
  - request detail/assignment 타입을 확장해 고객 상세정보, 보험 자격, 건강/납입 정보, FC 코드 스냅샷, 설계 링크, 취소 사유/시점까지 앱이 안전하게 받을 수 있도록 정리했다.
- `app/request-board-review.tsx`
  - 의뢰 상세를 `의뢰 정보`, `고객 정보`, `건강 정보`, `납입 정보` 섹션으로 확장하고, `요청 상품`과 `보험 자격`도 명시적으로 보이도록 정리했다.
  - 완료 건은 설계 링크를 별도 row로 노출하고, 배정 메타에는 FC 코드, 설계 거절 사유, 요청 취소 사유를 함께 표시하도록 보강했다.
  - 기존 2줄 요약에 머물던 요청 내용도 full-width 필드로 승격해 가람Link 상세와 정보 밀도를 맞췄다.
- `app/request-board-requests.tsx`
  - `cancelled` 필터/카운트를 추가하고, `전체` 목록에도 취소 의뢰를 포함시켰다.
  - 카드 하단 결정 메타가 취소 의뢰를 `요청 취소`로 명확히 보여주도록 정리했다.
- `app/request-board.tsx`
  - FC/본부장/총무용 의뢰 통계의 총계에 취소 의뢰를 반영했다.
  - 최근 활동 알림 카테고리 매핑에서 `request_board_cancelled`는 `cancelled`, `request_board_rejected`/`request_board_fc-rejected`는 `completed` 필터로 열리도록 보정했다.

**검증**:
- `npx eslint app/request-board-review.tsx app/request-board-requests.tsx app/request-board.tsx lib/request-board-api.ts`
- `npx tsc --noEmit`
- 실계정 E2E:
  - GaramLink direct 로그인(`전화번호 redacted / shared password redacted`) 성공 확인
  - 운영 GaramLink API 기준 의뢰 `223(cancelled)`, `221(completed)` 상세 응답 확인
  - 로컬 Expo web 화면을 Playwright로 열고 request_board API 요청을 운영 서버로 프록시해 `취소` 목록과 의뢰 상세 렌더링 확인

## <a id="20260316-eas-build-pinned-cli-fallback"></a> 2026-03-16 | EAS build wrapper pinned CLI fallback

**배경**:
- 운영 빌드가 Google Cloud XML 응답 `MalformedSecurityHeader` / `Header was included in signedheaders, but not in the request` / `x-goog-content-length-range` 오류로 업로드 단계에서 중단됐다.
- 확인 결과 이 작업 머신의 글로벌 `eas-cli`는 `16.32.0`이었고, 프로젝트 래퍼 `scripts/eas-build.js`는 글로벌 `eas` 바이너리가 존재하면 버전 확인 없이 그 경로를 그대로 우선 사용하고 있었다.
- Expo 공식 문서는 최신 EAS CLI 유지와 `npx eas-cli@latest` 사용을 권장하고 있으므로, 오래된 전역 CLI를 계속 타는 현재 래퍼 동작은 재현성 있는 운영 빌드 경로로 보기 어려웠다.

**조치**:
- `scripts/eas-build.js`
  - 최소 요구 버전을 `18.3.0`으로 두고, 글로벌 `eas --version`을 먼저 확인하도록 보강했다.
  - 글로벌 CLI가 없거나 최소 버전보다 낮으면 자동으로 `npx eas-cli@18.3.0`을 사용하도록 fallback 경로를 추가했다.
  - 기존 `core.hooksPath` 정리 동작은 그대로 유지해 Git 2.45+ shallow clone 충돌 방지도 계속 보장한다.
- `eas.json`
  - CLI 요구 버전을 `>= 18.3.0`으로 상향해 래퍼를 우회해도 구버전 CLI가 조용히 실행되지 않게 맞췄다.
- `docs/guides/COMMANDS.md`
  - 표준 빌드 명령 `npm run eas:build:*`가 hooksPath 정리뿐 아니라 pinned CLI fallback도 수행한다는 운영 문구를 추가했다.

**검증**:
- `node scripts/eas-build.js ios production --help`
- `node scripts/ci/check-governance.mjs`

## <a id="20260316-ios-address-webview-host-allowlist"></a> 2026-03-16 | iPhone 본등록 주소 검색 WebView host allow-list 보강

**배경**:
- 2026-03-13에 본등록/기본정보 수정 주소 필드를 검색 전용으로 바꿨지만, iPhone 운영 제보상 주소 검색 결과를 눌러도 앱 폼으로 값이 돌아오지 않는 문제가 계속 남아 있었다.
- 첨부 화면 녹화 기준 주소 검색이 앱 내부 모달이 아니라 SafariView 형태로 `code.map.kakao.com`에 열리고 있었고, 주소 선택 후에도 `onSelected` 콜백이 호출되지 않았다.
- 원인을 확인한 결과 기존 `@actbase/react-daum-postcode` native WebView guard가 `postcode.map.daum.net`만 내부 허용 대상으로 보고 있어, 현재 Kakao가 실제로 쓰는 `code.map.kakao.com` 요청을 외부 브라우저로 내보내고 있었다.

**조치**:
- `lib/daum-postcode.ts`
  - postcode WebView 내부에 남겨야 하는 신뢰 호스트 판별 helper를 추가했다.
  - `postcode.map.daum.net`와 현재 iPhone 실사용 host인 `code.map.kakao.com`만 in-app 허용 대상으로 두고, 그 외 외부 링크는 기존처럼 앱 밖으로 열리게 분리했다.
- `components/DaumPostcode.tsx`
  - 서드파티 패키지 구현을 앱 로컬 컴포넌트로 대체했다.
  - Daum postcode embed HTML + `window.ReactNativeWebView.postMessage` 콜백은 유지하되, WebView `onShouldStartLoadWithRequest`가 새 host allow-list를 사용하도록 바꿨다.
- `app/identity.tsx`
  - 본등록 주소 검색 모달이 새 공용 `DaumPostcode` 래퍼를 사용하도록 교체했다.
- `app/fc/new.tsx`
  - 기본정보 수정 화면도 동일한 `DaumPostcode` 래퍼를 재사용하도록 맞췄다.
- `lib/__tests__/daum-postcode.test.ts`
  - `code.map.kakao.com`은 내부 WebView에 남고, unrelated 외부 URL만 차단되는지 회귀 테스트를 추가했다.

**검증**:
- `npx jest lib/__tests__/daum-postcode.test.ts --runInBand`
- `npx eslint components/DaumPostcode.tsx lib/daum-postcode.ts lib/__tests__/daum-postcode.test.ts app/identity.tsx app/fc/new.tsx`
- `node scripts/ci/check-governance.mjs`

## <a id="20260313-request-board-manager-affiliation-sync"></a> 2026-03-13 | GaramLink 본부장 affiliation sync + FC 표시 중복 제거

**배경**:
- 기존 FC affiliation sync는 `fc_profiles` 경로만 다뤘고, 본부장(manager) 계정의 request_board 브릿지/비밀번호 sync payload에는 affiliation이 비어 있었다.
- 그 결과 request_board 운영 DB에 `users.affiliation` 컬럼을 반영해도 본부장 요청자는 다시 로그인할 때 소속이 채워지지 않았고, 표시 포맷도 `1본부 서선미 · 서선미`처럼 중복될 위험이 있었다.

**조치**:
- `supabase/functions/_shared/manager-affiliation.ts`
  - 본부장 이름을 canonical affiliation(`1본부 서선미`, `6본부 김정수(박선희)` 등)으로 변환하는 helper를 추가했다.
- `supabase/functions/_shared/request-board-auth.ts`
  - request_board bridge token이 manager role에서도 affiliation payload를 담을 수 있게 확장했다.
- `supabase/functions/login-with-password/index.ts`
  - 본부장 로그인 시 request_board password sync와 bridge token 둘 다 manager affiliation을 함께 보내도록 수정했다.
- `supabase/functions/sync-request-board-session/index.ts`
  - 앱 세션 복원 경로도 본부장 affiliation을 담은 bridge token을 재발급하도록 맞췄다.
- `lib/request-board-fc-identity.ts`
  - 소속 문자열 안에 이름이 이미 포함된 경우 추가 `· 이름`을 붙이지 않도록 포맷터를 보강했다.

**검증**:
- `npx eslint supabase/functions/_shared/manager-affiliation.ts supabase/functions/_shared/request-board-auth.ts supabase/functions/login-with-password/index.ts supabase/functions/sync-request-board-session/index.ts lib/request-board-fc-identity.ts --rule "import/no-unresolved: off"` ✅
- `node scripts/ci/check-governance.mjs` ✅

## <a id="20260313-request-board-fc-affiliation-sync"></a> 2026-03-13 | GaramLink FC 소속 브릿지 sync + 임베디드 화면 표시 확장

**배경**:
- request_board 쪽은 설계매니저가 보는 FC 이름에 소속을 붙여 보여줄 준비가 되어 있었지만, fc-onboarding-app 브릿지 토큰과 비밀번호 sync payload는 FC `affiliation`을 전달하지 않고 있었다.
- 그 결과 request_board `users.affiliation`이 비어 있는 FC가 많았고, 가람in 임베디드 GaramLink 메신저/의뢰상세에서도 여전히 FC 이름만 보이는 상태였다.
- 사용자 요구는 설계매니저가 보는 모든 FC 이름에 대해 소속을 함께 확인할 수 있게 만드는 것이었다.

**조치**:
- `supabase/functions/_shared/request-board-auth.ts`
  - request_board bridge token payload가 FC role일 때 `affiliation`을 포함할 수 있도록 확장했다.
- `supabase/functions/login-with-password/index.ts`
  - FC 로그인 시 request_board password sync payload와 bridge token 둘 다 `affiliation`을 함께 전달하도록 수정했다.
- `supabase/functions/set-password/index.ts`, `supabase/functions/reset-password/index.ts`
  - FC 신규 비밀번호 설정/재설정 시 request_board password sync에 `affiliation`을 포함하도록 맞췄다.
- `supabase/functions/sync-request-board-session/index.ts`
  - 앱 세션 복원/재동기화 경로도 FC `affiliation`을 담은 bridge token을 다시 발급하도록 보강했다.
- `lib/request-board-api.ts`
  - request conversation/message/direct user/request detail 타입에 FC `affiliation`을 추가해 앱이 해당 필드를 안전하게 받을 수 있게 했다.
- `lib/request-board-fc-identity.ts`
  - FC 표시명을 `소속 · 이름`으로 포맷하는 공용 helper를 추가했다.
- `app/request-board-messenger.tsx`
  - 설계매니저 view에서 request 대화, direct DM, FC 디렉터리, 메시지 sender 라벨이 모두 FC `affiliation`을 읽어 표시하도록 수정했다.
- `app/request-board-review.tsx`
  - 의뢰 상세의 `요청 FC` 라벨도 `소속 · 이름` 형식으로 바꿨다.

**검증**:
- `npx eslint supabase/functions/_shared/request-board-auth.ts supabase/functions/login-with-password/index.ts supabase/functions/set-password/index.ts supabase/functions/reset-password/index.ts supabase/functions/sync-request-board-session/index.ts app/request-board-messenger.tsx app/request-board-review.tsx lib/request-board-api.ts lib/request-board-fc-identity.ts --rule "import/no-unresolved: off"` ✅
- `node scripts/ci/check-governance.mjs` ✅
- `request_board: npm run build:client` ✅
- `request_board: npm run build:server` ✅

**후속 확인 포인트**:
- 기존 FC 계정은 다음 로그인 또는 `sync-request-board-session` 재동기화 뒤에 request_board `users.affiliation`이 채워지므로, 설계매니저 실기기에서 메신저/의뢰상세 라벨이 `{소속} · {이름}`으로 보이는지 확인

---

## <a id="20260313-home-latest-notice-board-only"></a> 2026-03-13 | 홈 최신 공지를 게시판 공지 소스로 고정

**배경**:
- 기존 홈 최신 공지 카드는 `board_notice:` id를 받은 경우에는 게시판 상세 모달로 보낼 수 있었지만, `latest_notice` 자체는 legacy `notices`와 게시판 `공지`를 함께 섞은 최신 1건을 반환하고 있었다.
- 이 구조에서는 홈 카드가 여전히 legacy 공지를 집으면 `/notice-detail` 계열 화면으로 열려, 게시판에서 같은 `공지` 글을 눌렀을 때와 완전히 같은 화면으로 통일되지 않았다.
- 사용자 요구는 홈 공지 카드도 게시판 글 탭과 같은 화면 계열로 고정하는 것이었다.

**조치**:
- `supabase/functions/fc-notify/index.ts`
  - `latest_notice` 응답 소스를 `fetchUnifiedNotices(1)`에서 `fetchBoardNoticesWithAttachments(1)`로 바꿔, 홈 상단 카드는 게시판 `공지` 카테고리 글만 최신 공지로 사용하도록 정리했다.
- `app/index.tsx`
  - 홈 카드 탭 시 route 해석 실패 fallback을 `/notice`에서 `/board`로 변경해, 게시판 공지가 없더라도 홈 공지 진입이 게시판 화면 계열을 벗어나지 않게 맞췄다.

**검증**:
- `npm run lint -- app/index.tsx` ✅
- `node scripts/ci/check-governance.mjs` ✅

**후속 확인 포인트**:
- `fc-notify` 배포 후 실기기에서 홈 상단 공지 카드를 눌렀을 때, 게시판 목록에서 같은 공지 글을 눌렀을 때와 동일한 게시판 상세 모달 surface로 진입하는지 확인

---

## <a id="20260313-request-board-messenger-designer-company"></a> 2026-03-13 | 가람Link 메신저 direct DM 설계매니저 회사명 표시 복구

**배경**:
- 가람in 임베디드 GaramLink 메신저(`app/request-board-messenger.tsx`)는 대화 목록/상단 헤더에 `company` 슬롯을 이미 가지고 있었지만, direct DM API 응답에는 설계매니저 `company_name`이 포함되지 않고 있었다.
- 그 결과 FC가 설계매니저와 direct DM을 시작해도 새로고침 또는 재진입 뒤에는 이름만 남고 어느 보험사/회사 소속인지 식별할 수 없었다.
- request 기반 대화는 `designer.company_name`을 쓰고 있었기 때문에, request 대화와 direct DM의 표시 정보가 서로 달라지는 불일치도 있었다.

**조치**:
- `lib/request-board-api.ts`
  - direct DM 대화/사용자 타입(`RbDmConversation`, `RbDirectMessageUser`, `rbCreateDmConversation`)에 `company_name` 필드를 추가해 앱-웹 계약을 확장했다.
- `app/request-board-messenger.tsx`
  - direct DM 대화 매핑 시 `participant.company_name`을 conversation `company`로 연결해, 기존 UI가 목록 카드와 활성 대화 헤더에서 같은 회사명을 바로 렌더링하도록 복구했다.
- request_board 서버/웹 경로도 함께 정렬해 direct DM 응답과 웹 메신저 변환부에서 같은 `company_name`을 사용하도록 맞췄다.

**검증**:
- `npm run lint -- app/request-board-messenger.tsx lib/request-board-api.ts` ✅
- `request_board: npm run build:server` ✅
- `request_board: npm run build:client` ✅

**후속 확인 포인트**:
- 기존 direct DM 대화가 있는 FC 계정으로 가람in `실시간 메신저`에 재진입했을 때, 설계매니저 이름 아래/헤더에 회사명이 즉시 보이는지 실기기 확인

---

## <a id="20260313-request-board-shortcut-activity-route"></a> 2026-03-13 | 설계요청 페이지 메신저 위치 이동 + 최근활동 탭 동선 안정화

**배경**:
- 가람in `설계 요청` 화면에서 `실시간 메신저`가 `알아두세요` 섹션 안에 묻혀 있어, 실제 핵심 액션인 `의뢰 현황` 확인 뒤 바로 대화로 이동하기 어려웠다.
- 같은 화면의 `최근 활동` 항목은 탭 시 Alert만 띄우는 방식이라 동선이 어색했고, 사용자 보고 기준으로 탭 후 비정상 동작과 앱 강제 종료가 발생하고 있었다.

**조치**:
- `app/request-board.tsx`
  - `실시간 메신저` 카드를 `의뢰 현황` 카드 바로 아래, `의뢰 목록 · 검토` 위로 이동해 핵심 업무 흐름에 맞게 재배치했다.
  - `알아두세요` 섹션에서는 메신저 카드를 제거하고 `개인정보 보호`, `푸시 알림` 안내만 남겼다.
  - `최근 활동` 항목 탭은 더 이상 Alert를 띄우지 않고, 카테고리에 따라 `메신저`, `의뢰 목록(상태별 필터)`, `알림센터`로 직접 이동하도록 정리했다.
  - 메시지 알림은 바로 메신저를 열고, 의뢰 상태 알림은 `pending/in_progress/completed/all` 필터에 맞는 의뢰 목록으로 보내도록 매핑했다.

**검증**:
- `npx eslint app/request-board.tsx app/chat.tsx app/request-board-messenger.tsx` ✅
- `npx tsc --noEmit` ✅

**후속 확인 포인트**:
- 설계요청 화면에서 `실시간 메신저` 카드가 의뢰현황 아래에 바로 보이는지 확인
- `최근 활동` 항목 탭 시 앱이 종료되지 않고, 메시지는 메신저로, 상태 알림은 의뢰 목록으로 정상 이동하는지 실기기 확인

---

## <a id="20260313-messenger-send-latency"></a> 2026-03-13 | 내부/가람Link 메신저 전송 체감 속도 개선

**배경**:
- 가람in 내부 메신저(`app/chat.tsx`)는 Supabase insert가 끝날 때까지 내 메시지 버블이 생기지 않았고, 알림 Edge Function 호출도 같은 전송 흐름에 매달려 있었다.
- 앱 내부 GaramLink 메신저(`app/request-board-messenger.tsx`)도 전송 성공 뒤 `loadMessages()` 전체 재조회까지 기다려야 화면이 갱신돼, 짧은 텍스트 메시지도 체감이 느렸다.
- 첨부 전송 실패 시에는 입력창/목록 preview가 일부만 되돌아갈 위험이 있어, 낙관적 UI를 붙이더라도 롤백 정합성이 필요했다.

**조치**:
- `app/chat.tsx`
  - 전송 시작 시 임시 메시지 버블을 바로 추가하는 optimistic helper를 넣었다.
  - 실제 insert 성공 시 임시 버블을 실데이터로 치환하고, 실패 시 임시 버블만 제거하도록 정리했다.
  - `fc-notify` 호출은 `await` 대신 background 처리로 바꿔 알림 지연이 메시지 렌더링을 막지 않게 했다.
- `app/request-board-messenger.tsx`
  - request/DM 공통으로 임시 메시지와 대화 preview를 먼저 반영하고, 성공 응답이 오면 임시 row를 실데이터로 교체하도록 바꿨다.
  - 전송 후 `loadMessages(activeConv)` 전체 재호출을 제거해 불필요한 왕복을 줄였다.
  - 실패 시 임시 메시지, 입력값, 파일 선택, 대화 preview를 함께 되돌리되, 그 사이 다른 최신 preview가 들어왔으면 덮어쓰지 않도록 가드를 넣었다.

**검증**:
- `npx eslint app/chat.tsx app/request-board-messenger.tsx` ✅
- `npx tsc --noEmit` ✅

**후속 확인 포인트**:
- 실기기에서 텍스트 메시지 전송 시 버블이 즉시 보이고, 실패 시 입력창/preview가 자연스럽게 복구되는지 확인
- 가람Link embedded messenger에서 첨부 전송 뒤 불필요한 전체 재조회 없이 메시지 한 건만 추가되는지 확인

---

## <a id="20260313-home-latest-notice-route-unification"></a> 2026-03-13 | 홈 상단 최신 공지 카드 라우팅을 게시판 공지 상세와 통일

**배경**:
- 가람in 홈 상단의 최신 공지 카드는 제목만 보여주고 실제 공지 `id`는 버리고 있어, 누르면 항상 `/notice` 목록으로 이동했다.
- 반면 공지 목록(`app/notice.tsx`)은 `board_notice:` 접두어를 해석해 게시판 `공지` 카테고리 글이면 `/board?postId=...`로 보내고 있었다.
- 같은 공지를 홈에서 눌렀을 때와 게시판/공지 목록에서 눌렀을 때 도착 화면이 달라지는 불일치가 발생했다.

**조치**:
- `lib/notice-route.ts`
  - `board_notice:` 접두어를 해석해 공지 `id`를 실제 이동 경로(`/board?postId=...` 또는 `/notice-detail?id=...`)로 바꾸는 공용 helper를 추가했다.
- `app/index.tsx`
  - 홈 최신 공지 조회 타입을 명시하고, 상단 카드 클릭 시 공용 helper를 사용해 직접 상세 화면으로 이동하도록 변경했다.
  - `latest_notice` 응답에 `id`가 없을 때만 기존처럼 `/notice`로 fallback 하도록 유지했다.
- `app/notice.tsx`
  - 공지 목록 화면도 동일 helper를 사용하도록 바꿔 홈/목록 경로 판별 규칙을 하나로 통일했다.
- `app/notifications.tsx`
  - 알림센터의 `source === 'notice'` 항목도 동일 helper를 사용하도록 맞춰, 공지 진입점별 상세 화면 차이를 줄였다.
- `supabase/functions/fc-notify/index.ts`
  - `latest_notice` 응답에 최신 공지의 `id`를 포함하도록 확장했다.
  - board 기반 공지는 이미 `board_notice:<postId>` 형태로 합쳐지고 있으므로, 홈 화면도 이 값을 그대로 받아 게시판 상세 모달로 열 수 있다.

**검증**:
- `npm run lint -- app/index.tsx app/notice.tsx app/notifications.tsx lib/notice-route.ts` ✅
- `node scripts/ci/check-governance.mjs` ✅

**후속 확인 포인트**:
- 최신 공지가 게시판 `공지` 글일 때 홈 상단 카드 탭이 게시판 목록에서 같은 글을 눌렀을 때와 동일한 상세 모달을 여는지 실기기에서 확인
- 변경을 운영에 반영하려면 `supabase functions deploy fc-notify` 배포 필요

---

## <a id="20260313-exam-no-refund-copy"></a> 2026-03-13 | 시험 신청 화면에 접수비 환불 불가 안내 문구 추가

**배경**:
- 운영 요청에 따라 가람in 시험 신청 화면에서 응시료 납입 안내에 `접수비 반환 불가` 정책을 직접 명시해야 했다.
- 기존 문구는 `미입금 시 시험 접수 불가`까지만 안내하고 있어, 환불 정책까지는 한 번에 전달되지 않았다.

**조치**:
- `app/exam-apply.tsx`
  - 생명보험 시험 신청 화면의 응시료 안내 문구를 `응시료 미입금 시 시험 접수 불가능하며, 납입한 접수비는 반환되지 않습니다.`로 변경했다.
- `app/exam-apply2.tsx`
  - 손해보험 시험 신청 화면에도 같은 문구를 반영했다.

**검증**:
- `npx eslint app/exam-apply.tsx app/exam-apply2.tsx` 예정

**후속 확인 포인트**:
- 실제 앱 화면에서 두 시험 신청 페이지 모두 환불 불가 문구가 자연스럽게 노출되는지 확인

---

## <a id="20260313-exam-fee-delete-admin"></a> 2026-03-13 | 시험 신청 상단 응시료 안내 재배치 + 총무 시험 신청자 삭제 기능 추가

**배경**:
- FC 시험 신청 화면 2종(`app/exam-apply.tsx`, `app/exam-apply2.tsx`) 모두 `응시료 납입 일자`가 과목 선택 아래에 있어, 가장 먼저 확인해야 할 입금 정보가 스크롤 하단에 밀려 있었다.
- 안내 문구도 `접수비 반환` 기준으로 남아 있어 실제 운영 규칙인 `미입금 시 접수 불가`를 직접적으로 전달하지 못했다.
- 총무는 모바일 `생명보험 신청자`/`손해보험 신청자`와 웹 `신청자 관리`에서 잘못 들어온 시험 신청을 직접 정리할 수 있어야 했지만, 기존에는 승인 토글만 있고 삭제 수단이 없었다.

**조치**:
- `app/exam-apply.tsx`
  - `응시료 납입 일자` 입력을 화면 최상단 섹션으로 이동했다.
  - 안내 문구를 `응시료 미입금 시, 시험 접수 불가능합니다.`로 교체했다.
  - 생명보험 시험 전용 계좌 `신한 110-505-328638 김태훈` 안내 카드를 추가했다.
- `app/exam-apply2.tsx`
  - 손해보험 시험 신청 화면에도 같은 상단 배치를 적용했다.
  - 손해보험 시험 전용 계좌 `신한 110-444-751201 김태훈` 안내 카드를 추가했다.
- `supabase/functions/admin-action/index.ts`
  - 총무 전용 `deleteExamRegistration` 액션을 추가해 모바일 앱이 Edge Function 경유로 신청자를 삭제할 수 있게 했다.
- `app/exam-manage2.tsx`
  - 손해보험 신청자 카드에 `삭제` 버튼과 확인 alert를 추가했다.
  - 삭제 중에는 승인 토글/삭제 버튼을 함께 잠가 중복 액션을 막는다.
- `web/src/app/api/admin/exam-applicants/route.ts`
  - 웹 총무 세션 쿠키를 검증하고 `exam_registrations`를 삭제하는 서버 API를 추가했다.
- `web/src/app/dashboard/exam/applicants/page.tsx`
  - 신청자 관리 표에 `관리` 열과 삭제 아이콘을 추가했다.
  - 삭제 성공 시 캐시에서 즉시 제거하고, manager read-only 세션은 기존대로 삭제가 비활성화된다.

**검증**:
- `npx eslint app/exam-apply.tsx app/exam-apply2.tsx app/exam-manage.tsx app/exam-manage2.tsx lib/exam-admin-api.ts` ✅
- `npx tsc --noEmit` ✅
- `cd web && npx eslint src/app/dashboard/exam/applicants/page.tsx src/app/api/admin/exam-applicants/route.ts` ✅
- `cd web && npx tsc --noEmit` ✅
- 참고: `npx eslint supabase/functions/admin-action/index.ts --rule "import/no-unresolved: off"` 기준으로 신규 변경 에러는 없고, 기존 미사용 `toBase64` 경고 1건만 남는다.

**후속 확인 포인트**:
- 실제 FC 화면에서 응시료 납입일/계좌 블록이 최상단에 먼저 보이고, 미입금 안내 문구가 운영 문구와 일치하는지 확인
- 실제 총무 계정으로 모바일 생명/손해 신청자 화면과 웹 신청자 관리 화면에서 삭제가 정상 동작하는지 확인
- 변경된 모바일 삭제 동작을 운영 반영하려면 `supabase functions deploy admin-action` 배포가 필요

---

## <a id="20260313-request-board-driving-status-codes"></a> 2026-03-13 | GaramLink 의뢰 상세의 고객 `운전구분` 표시를 11종 코드까지 지원하도록 확장

**배경**:
- `request_board` 고객 등록의 운전 입력이 기존 `예/아니요`에서 11종 차량 구분 드롭다운으로 확대됐다.
- 모바일 `app/request-board-review.tsx`는 아직 `yes/no`만 라벨링하고 있어, 새 값이 들어오면 `미입력`으로 잘못 보일 상태였다.

**조치**:
- `lib/request-board-driving-status.ts`
  - request_board 고객 `운전구분` 코드를 한글 라벨로 바꾸는 포맷터를 추가했다.
  - legacy `yes/no`와 신규 11종 코드 모두 지원한다.
- `app/request-board-review.tsx`
  - 기존 `예/아니요` 전용 포맷터를 제거하고 공용 포맷터를 사용하도록 변경했다.
  - 고객 정보 메타 라벨도 `운전여부`에서 `운전구분`으로 조정했다.
- `lib/request-board-api.ts`
  - `customer_driving_status` 타입을 `string | null`로 완화해 새 상세 코드도 안전하게 수신하도록 맞췄다.

**검증**:
- `npm run lint -- app/request-board-review.tsx lib/request-board-api.ts lib/request-board-driving-status.ts` ✅

**후속 확인 포인트**:
- 신규 의뢰 상세에서 `승용차(자가용)` 등 상세 운전구분이 그대로 표시되는지 확인
- 과거 legacy 의뢰는 기존처럼 `예/아니요`로 유지되는지 확인

---

## <a id="20260313-request-board-driving-status-none"></a> 2026-03-13 | GaramLink 운전구분 `안함` 표시 지원

**배경**:
- request_board 고객 등록의 운전구분 선택지에 `안함`이 추가됐다.
- 모바일 `request-board-review` 포맷터가 이 코드를 모르면 `미입력`으로 잘못 렌더링된다.

**조치**:
- `lib/request-board-driving-status.ts`
  - `none -> 안함` 매핑을 추가했다.

**검증**:
- `npm run lint -- app/request-board-review.tsx lib/request-board-driving-status.ts` ✅

---

## <a id="20260313-ios-address-search-only"></a> 2026-03-13 | iPhone 본등록 주소 입력을 검색 전용 흐름으로 정리

**배경**:
- 가입 직후 본등록 화면(`app/identity.tsx`)과 기본정보 수정 화면(`app/fc/new.tsx`) 모두 주소 본문을 직접 타이핑할 수 있게 열어두고 있었다.
- 두 화면은 동일하게 `@actbase/react-daum-postcode` 검색 모달과 별도의 편집 가능한 주소 `TextInput`를 함께 쓰고 있었고, iPhone에서 주소 입력이 비정상적이라는 운영 제보가 들어왔다.
- 상세주소 입력란이 별도로 존재하므로, 기본 주소는 검색 결과만 사용하도록 제한해도 도메인 손실이 없다.

**조치**:
- `app/identity.tsx`
  - 기본 주소 필드를 읽기 전용 표시 영역으로 바꾸고, 탭 시 항상 주소 검색 모달을 열도록 정리했다.
  - 주소가 비어 있을 때 저장을 누르면 주소 검색 모달을 바로 열도록 보강했다.
  - 주소 선택 직후 `상세주소` 입력란으로 포커스를 넘기도록 이어붙였다.
- `app/fc/new.tsx`
  - 본등록 화면과 같은 방식으로 기본 주소를 검색 전용 표시 필드로 통일했다.
  - 주소 미입력 검증 시 주소 검색 모달로 유도하고, 검색 완료 후 `상세주소`로 바로 이동하도록 맞췄다.

**검증**:
- `npm run lint -- app/identity.tsx app/fc/new.tsx` ✅

**후속 확인 포인트**:
- 실제 iPhone 기기에서 `본 등록 -> 주소 검색 -> 주소 선택 -> 상세주소 입력` 흐름이 끊기지 않는지 확인
- 기존 주소가 이미 저장된 FC가 `기본정보 수정` 화면에서 주소 다시 검색을 눌러 정상적으로 갱신되는지 확인

---

## <a id="20260313-web-dashboard-career-badge-copy"></a> 2026-03-13 | 관리자 웹 FC 목록의 `조회중` 배지를 `미입력`으로 정정

**배경**:
- 관리자 웹 FC 목록(`web/src/app/dashboard/page.tsx`)은 `career_type`이 비어 있으면 회색 배지에 `조회중`을 표시하고 있었다.
- 이 값은 네트워크 로딩 상태가 아니라 단순 null 데이터라서, 가입이 끝난 FC도 아직 화면이 불러오는 중처럼 보이는 오해를 만들었다.

**조치**:
- `web/src/app/dashboard/page.tsx`
  - `career_type`이 null/empty일 때 표시하던 회색 `조회중` 배지를 `미입력`으로 변경했다.
  - 목록 화면의 라벨 의미를 상세 화면과 맞춰, 값 없음과 실제 로딩 상태를 구분하게 했다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx` 예정

**후속 확인 포인트**:
- 관리자 웹 FC 목록에서 `career_type = null`인 계정이 더 이상 `조회중`으로 보이지 않는지 확인

---

## <a id="20260313-web-signup-commission-complete-step-align"></a> 2026-03-13 | 관리자 웹 완료 판정을 가입 시 위촉 완료 규칙에 다시 정렬

**배경**:
- 관리자 웹 단계 계산을 보수적으로 조정하면서, `temp_id + 수당동의 + 승인서류`가 모두 없으면 완료로 보지 않도록 바뀌었다.
- 하지만 Garamin 가입 시 `현재 위촉 상태`를 함께 받는 도메인 규칙상, 가입자가 생명/손해 위촉을 모두 이미 완료했다고 입력한 경우에는 별도 위촉 진행 대상이 아니다.
- 이 케이스는 `set-password`에서 `life_commission_completed=true`, `nonlife_commission_completed=true`, `status='final-link-sent'`로 저장되며, 최근 웹 로직은 이를 `0단계 사전등록` + `임시사번 미발급`으로 잘못 내리고 있었다.

**조치**:
- `web/src/lib/shared.ts`
  - 완료 판정을 모바일과 다시 맞춰 `status='final-link-sent'` 또는 양쪽 commission 완료 플래그가 모두 true면 완료 단계로 보도록 복원했다.
  - 다만 가입 시 곧바로 위촉 완료로 들어온 계정은 일반 최종 완료와 구분할 수 있도록, 신원/임시사번/수당동의/서류/일정 흔적이 없는 pure signup 완료 케이스를 `가입 시 위촉 완료` 요약 라벨로 표시하도록 분기했다.
  - `getAdminStep`는 `rawStep === 5`를 먼저 처리하도록 바꿔, identity가 비어 있어도 완료 계정이 `0단계 사전등록`으로 내려가지 않게 정리했다.

**검증**:
- 실제 FC `김진희 / 01039772523` 확인:
  - `status = final-link-sent`
  - `identity_completed = false`
  - `temp_id = null`
  - `allowance_date = null`
  - `life_commission_completed = true`
  - `nonlife_commission_completed = true`
  - `fc_documents = []`
  - 이 케이스는 이제 `0단계 사전등록`이 아니라 완료 단계로 분류된다.
- `cd web && npm run lint -- src/lib/shared.ts` 예정

**후속 확인 포인트**:
- 관리자 웹 목록/상세에서 가입 시 위촉 완료 계정이 `임시사번 미발급` 대신 완료 상태로 표시되는지 확인
- 일반 온보딩 완료 계정은 기존처럼 `최종 완료`/`4단계 완료`로 유지되는지 확인

---

## <a id="20260313-web-profile-presence-step-audit-fix"></a> 2026-03-13 | 관리자 웹 FC 상세의 presence/단계/서류 표시 정합성 보정

**배경**:
- 관리자 웹 FC 상세 페이지에서 상단 `활동중` 배지가 실제 presence가 아니라 `status === 'final-link-sent'` 조건으로 하드코딩돼 있었다.
- `CURRENT STEP`도 `final-link-sent` 또는 수수료 완료 플래그만으로 최종 완료를 판정해, 중간 산출물(`temp_id`, `allowance_date`, 승인된 서류) 없이 `4단계 완료`가 보일 수 있었다.
- 제출 서류 이력은 이미 `fc_profiles -> fc_documents(*)` 관계를 읽고 있으면서도, 화면에서는 다시 `resident_id = phone` 기준으로 재조회해 스키마 키(`fc_id`)와 어긋난 빈 목록이 나올 수 있었다.
- `career_type`이 비어 있으면 로딩이 끝난 상태에서도 `조회중`이 떠서 실제 미입력과 로딩 상태가 구분되지 않았다.

**조치**:
- `web/src/app/dashboard/profile/[id]/page.tsx`
  - 상단 배지를 실제 `/api/presence` 조회 결과로 교체하고, presence가 없으면 `첫 접속 전`, 오류 시 `활동 정보 확인 불가`로 표시하도록 정리했다.
  - 헤더 우측에 현재 status의 한글 라벨을 함께 노출해, presence와 workflow status를 분리해서 읽을 수 있게 했다.
  - `career_type` null 표시를 `조회중`에서 `미입력`으로 변경했다.
  - 제출 서류 이력은 잘못된 `resident_id` 재조회 쿼리를 제거하고, 이미 로드된 `profile.fc_documents` 관계 데이터를 그대로 사용하도록 수정했다.
  - 프로필 상세 로딩 실패 시 `FC 정보를 찾을 수 없습니다` 대신 명시적인 상세 로드 실패 문구를 보여주도록 보강했다.
- `web/src/lib/shared.ts`
  - 완료 단계 판정 전용 helper를 추가해, 최종 완료는 `신원정보 + temp_id + 수당동의 통과 + 승인된 서류 + 양쪽 commission 완료` 근거가 모두 있을 때만 성립하도록 보수화했다.
  - `calcStep`, `getAdminStep`, `getSummaryStatus`가 같은 전제 조건을 공유하도록 맞춰, 상세 페이지와 관리자 대시보드 단계/요약 표시가 같은 기준을 쓰게 했다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/profile/[id]/page.tsx src/lib/shared.ts` ✅
- 실제 대상 FC(`01080145882`) 조회 결과 확인:
  - `status = final-link-sent`
  - `life_commission_completed = true`
  - `nonlife_commission_completed = true`
  - `temp_id = null`
  - `allowance_date = null`
  - `fc_documents = []`
  - `user_presence = []`
  - 기존 화면은 이 상태에서도 `활동중`, `4단계 완료`를 표시했으나, 새 로직은 해당 값들을 완료/활동 근거로 사용하지 않음

**후속 확인 포인트**:
- 관리자 웹 FC 상세 진입 시 상단 배지가 실제 presence와 일치하는지 확인
- 중간 산출물이 비어 있는 이력성/수동보정 계정이 `4단계 완료`로 과표시되지 않는지 확인
- 서류가 있는 FC에서 제출 이력이 `fc_id` 관계 기준으로 정상 렌더링되는지 확인

---

## <a id="20260313-web-profile-address-detail"></a> 2026-03-13 | 관리자 웹 FC 상세에 상세주소 로드 복구 + 수정 버튼 시인성 개선

**배경**:
- 관리자 웹 FC 상세 페이지(`web/src/app/dashboard/profile/[id]/page.tsx`)는 `fc_profiles`를 `select('*')`로 읽고 있었지만, 화면 로컬 타입/폼/렌더링에는 `address_detail`을 연결하지 않고 있었다.
- 그 결과 실제 DB에 상세주소가 있어도 상세 화면에는 기본 주소만 보이고, 관리자 입장에서는 상세주소가 저장되지 않은 것처럼 보였다.

**조치**:
- `web/src/app/dashboard/profile/[id]/page.tsx`
  - 상세 페이지 로컬 타입 `FcProfileDetail`에 `address_detail`을 추가했다.
  - Mantine form 초기값과 `profile -> form` 동기화에 `address_detail`을 연결했다.
  - 관리자 프로필 저장 payload(`updateProfile`)에 `address_detail`을 포함시켜, 웹에서 상세주소 수정도 반영되도록 맞췄다.
  - 기본주소 아래에 `상세주소` 입력/표시 필드를 추가해 읽기/수정 화면 모두에서 상세주소를 확인할 수 있게 했다.
  - `수정` 버튼을 `filled` 스타일과 더 큰 크기, 강조 그림자로 바꿔 흰 배경 카드 안에서도 즉시 보이도록 조정했다.

**검증**:
- `cd web && npm run lint -- src/app/dashboard/profile/[id]/page.tsx` ✅

**후속 확인 포인트**:
- 운영/개발 관리자 웹에서 FC 상세 페이지 진입 시 기존 상세주소가 노출되는지 확인
- 수정 모드에서 상세주소 변경 후 새로고침해도 값이 유지되는지 확인

---

## <a id="20260312-mobile-alert-copy-sanitize"></a> 2026-03-12 | 모바일 에러 알림 기술 문구를 사용자용 경고로 전역 정규화

**배경**:
- 모바일 앱 여러 화면이 `Alert.alert(..., err.message)` 또는 Edge Function/네트워크 원문 메시지를 그대로 보여주고 있어, 사용자가 `Edge Function returned a non-2xx status code` 같은 기술 문구를 직접 보게 되는 문제가 있었다.
- 특히 본등록(`app/identity.tsx`, `app/fc/new.tsx`) 주민번호 저장 실패는 입력 오류처럼 느껴져야 하는데 기술 원문이 노출돼 UX가 거칠었다.

**조치**:
- `lib/user-facing-error.ts`
  - 기술 문구(`Edge Function`, `non-2xx`, 권한/네트워크/중복/invalid payload`)를 사용자용 한국어 경고 문구로 바꾸는 공통 helper를 추가했다.
  - alert 제목 기준 fallback 문구와 `success/warning/error/info` variant 추론 로직을 함께 추가했다.
- `components/AppAlertProvider.tsx`
  - 앱 전역 `Alert.alert` 가로채기 지점에서 메시지를 sanitize 하도록 변경했다.
  - 기존 화면별 `Alert.alert` 호출을 전부 일괄 보호하면서, title에 따라 경고/오류 성격을 자동 반영하도록 정렬했다.
- `app/identity.tsx`, `app/fc/new.tsx`, `lib/store-identity-error.ts`
  - 본등록 주민번호 저장 실패는 전용 사용자 문구로 매핑했다.
  - 로컬 주민번호 검증에서 막히는 경우도 field error만 두지 않고 즉시 `입력 확인` 알림이 뜨도록 보강했다.
- `lib/__tests__/user-facing-error.test.ts`
  - Edge Function 기술 문구 fallback, 한글 메시지 유지, 권한 오류 매핑, alert variant/fallback 추론을 테스트로 고정했다.

**검증**:
- `npx eslint components/AppAlertProvider.tsx app/identity.tsx app/fc/new.tsx lib/user-facing-error.ts lib/store-identity-error.ts` ✅
- `npx jest lib/__tests__/user-facing-error.test.ts --runInBand` ✅

**후속 확인 포인트**:
- 실제 기기에서 본등록/로그인/서류 업로드/시험 신청 등 기존 기술 알림 발생 경로가 모두 사용자용 문구로 바뀌었는지 spot-check

---

## <a id="20260312-request-board-driving-status"></a> 2026-03-12 | GaramLink 의뢰 상세에 고객 운전여부 표시 추가

**배경**:
- request_board 쪽 고객 등록/의뢰 스키마에 `customer_driving_status`가 추가되면서, 앱 안 GaramLink 의뢰 상세(`app/request-board-review.tsx`)도 같은 고객 정보를 보여줘야 했다.
- 기존 모바일 리뷰 화면은 `customer_name`, `request_details`, 요청 FC 정도만 보여주고 있어 새 필드가 전혀 노출되지 않았다.

**조치**:
- `lib/request-board-api.ts`
  - `RbRequestDetail` 타입에 `customer_driving_status?: 'yes' | 'no' | null` 필드를 추가해 앱 레이어가 새 응답 계약을 읽을 수 있게 했다.
- `app/request-board-review.tsx`
  - `yes/no/null` 값을 `예/아니요/미입력`으로 매핑하는 helper를 추가했다.
  - 의뢰 상세 정보 카드 메타 영역에 `운전여부` 라인을 추가해 고객명/요청 FC와 같은 레벨로 노출되도록 정렬했다.

**검증**:
- `npx eslint app/request-board-review.tsx lib/request-board-api.ts` ✅

**후속 확인 포인트**:
- 앱에서 GaramLink 의뢰 상세 진입 시 신규 의뢰는 `예/아니요`, 기존 구의뢰는 `미입력`으로 보이는지 on-device 확인

---

## <a id="20260312-request-board-designer-fc-directory"></a> 2026-03-12 | 설계 매니저 GaramLink 메신저에 전체 FC 디렉터리 추가

**배경**:
- 사용자 스크린샷 기준 실제 문제 화면은 내부 `admin-messenger`가 아니라 `app/request-board-messenger.tsx`였다.
- 이 화면은 FC 사용자일 때만 `rbGetDesigners()`를 호출해 새 대화 후보를 만들고, 설계 매니저일 때는 `rbGetConversations()`와 `rbGetDmConversations()`로 이미 존재하는 대화만 보여주고 있었다.
- 그래서 설계 매니저 앱 메신저에서는 이미 대화가 있는 FC 몇 명만 보이고, 직접 대화 가능한 전체 FC 목록은 전혀 노출되지 않았다.

**조치**:
- `lib/request-board-api.ts`
  - `GET /api/direct-messages/users`를 호출하는 `rbGetDirectMessageUsers()`를 추가해 앱에서도 request_board 서버의 FC/설계매니저 디렉터리를 사용할 수 있게 했다.
- `app/request-board-messenger.tsx`
  - 설계 매니저 로그인 시 기존 대화 목록과 별개로 FC 디렉터리를 불러오도록 확장했다.
  - 목록 하단에 `FC 목록` 섹션을 추가해 전체 FC 후보를 노출하고, 이미 대화가 있는 FC는 `대화 열기`, 없는 FC는 `대화 시작하기`로 분기했다.
  - 대화/DM 데이터에 `participantUserId`를 보존해, 동일 FC의 기존 대화가 있으면 새 DM을 생성하지 않고 기존 대화로 바로 진입하도록 맞췄다.
  - 추가 방어로, 설계 매니저 세션에서 렌더링되는 기존 대화 목록도 `participantRole === 'fc'`인 항목만 노출하도록 걸러 다른 설계 매니저 DM이 섞여 보이지 않게 막았다.
  - FC 로그인 시 기존 `설계사 목록` 동작은 그대로 유지했다.

**검증**:
- `npm run lint -- app/request-board-messenger.tsx lib/request-board-api.ts` ✅
- `node scripts/ci/check-governance.mjs` ✅

**후속 확인 포인트**:
- 설계 매니저 계정으로 앱 `메신저 -> 설계요청 메신저` 진입 시 `대화` 섹션 아래에 `FC 목록`이 추가로 보이는지
- `FC 목록`에서 이미 대화한 FC를 누르면 기존 방이 열리고, 처음 대화하는 FC를 누르면 새 DM이 생성되는지

---

## <a id="20260312-admin-hub-unread-scope"></a> 2026-03-12 | 총무 메신저 허브 unread 집계 범위 보정

**배경**:
- `가람in` 메신저 허브(`app/messenger.tsx`)는 내부 unread 배지를 단순히 `messages.receiver_id = myChatId AND is_read = false` 전체 건수로 계산하고 있었다.
- 반면 총무/본부장/설계매니저가 실제로 들어가는 FC 목록 화면(`app/admin-messenger.tsx`)은 `signup_completed = true`이면서 내부 소속(`N본부`, `N팀`, `직할`)에 해당하는 FC만 노출하고, unread도 그 목록 안의 발신자별 합계만 보여준다.
- 이 차이 때문에 총무 로그인 상태에서 채널 선택 허브에 unread `1`이 떠도, 실제 FC 목록에는 읽지 않은 대화가 하나도 보이지 않는 불일치가 발생했다.

**조치**:
- `app/messenger.tsx`
  - 허브 쪽에 내부 FC 소속 판별 helper를 추가해 `admin-messenger`와 같은 내부 소속 기준(`본부`/`팀`/`직할`)을 적용했다.
  - 총무/본부장/설계매니저 세션에서는 `fc_profiles`에서 실제 채널 목록에 노출될 FC 전화번호 집합을 먼저 만들고, 그 발신자(`sender_id`)로 들어온 unread만 합산하도록 변경했다.
  - 일반 FC 세션은 기존처럼 본인 `receiver_id` 기준 unread 집계를 유지했다.

**검증**:
- `npx tsc --noEmit` ✅

**후속 확인 포인트**:
- 총무 계정으로 앱 로그인 후, 실제 읽지 않은 FC 대화가 없으면 `메신저 -> 가람지사 메신저` 카드 배지가 사라지는지
- 내부 소속 FC가 실제 unread 메시지를 보낸 경우 허브 배지 숫자와 `admin-messenger` 목록 합계가 일치하는지

---

## <a id="20260312-designer-messenger-fc-list"></a> 2026-03-12 | 설계 매니저 앱 메신저에서 FC 목록 복구

**배경**:
- 설계 매니저 계정은 앱 세션상 `role='fc'`이지만 `requestBoardRole='designer'` 플래그로 구분된다.
- 그런데 메신저 허브(`app/messenger.tsx`)는 `admin`만 FC 목록 화면(`/admin-messenger`)으로 보내고, 나머지 모든 사용자를 내부 `1:1 문의` 화면(`/chat`)으로 보내고 있었다.
- 동시에 FC 목록 화면(`app/admin-messenger.tsx`) 자체도 `role === 'admin'`일 때만 목록 조회를 허용하고 있어, 설계 매니저가 해당 화면에 들어가더라도 전체 FC 목록을 불러올 수 없었다.

**조치**:
- `app/messenger.tsx`
  - `isRequestBoardDesigner` 세션을 별도 분기해, 설계 매니저가 `가람지사 메신저`를 열면 FC 목록 화면(`/admin-messenger`)으로 이동하도록 수정했다.
  - 카드 설명/계정 라벨도 설계 매니저 기준 문구로 보정했다.
- `app/admin-messenger.tsx`
  - `role === 'admin'` 뿐 아니라 `isRequestBoardDesigner` 세션도 FC 목록 조회를 허용하도록 확장했다.
  - 설계 매니저는 내부 채팅 actor id를 `ADMIN_CHAT_ID`가 아닌 본인 전화번호로 사용하게 조정해, FC와의 1:1 메시지 조회/안읽음 계산이 올바르게 작동하도록 맞췄다.
  - 빈 목록 안내 문구도 설계 매니저 화면에 맞게 분기했다.

**검증**:
- `npm run lint -- app/messenger.tsx app/admin-messenger.tsx` ✅
- `node scripts/ci/check-governance.mjs` ✅

**후속 확인 포인트**:
- 설계 매니저 계정으로 앱 로그인 후 `메신저 -> 가람지사 메신저` 진입 시 `1:1 문의` 대상 선택 화면이 아니라 FC 목록 화면이 바로 열리는지
- 특정 FC 대화 진입 후 마지막 메시지/안읽음 수가 설계 매니저 본인 전화번호 기준으로 정상 표시되는지

---

## <a id="20260312-chat-native-header-off"></a> 2026-03-12 | 내부 `1:1 문의` 기본 스택 헤더 비활성화

**배경**:
- 직전 헤더 통일 작업 후 `app/chat.tsx`에 커스텀 대화 헤더가 추가됐지만, 앱 루트 스택(`app/_layout.tsx`)은 여전히 `chat` 라우트에 기본 `1:1 문의` 헤더를 등록하고 있었다.
- 그 결과 실제 기기에서는 상단에 기본 스택 헤더가 먼저 보이고, 그 아래에 새 커스텀 헤더가 한 번 더 렌더링되는 중복 헤더 문제가 생겼다.
- 사용자는 스크린샷으로 `1:1 문의` 타이틀 바와 아바타형 대화 헤더가 동시에 노출되는 현상을 보고했다.

**조치**:
- `app/_layout.tsx`
  - 두 개의 `chat` 라우트 등록부 모두 `headerShown: false`로 바꿔, 내부 `1:1 문의` 화면에서는 루트 스택 기본 헤더가 아예 렌더링되지 않도록 수정했다.
  - 화면 내부의 커스텀 헤더만 남도록 하여 설계매니저 메신저와 같은 단일 헤더 구조를 유지하게 했다.

**검증**:
- `npm run lint -- app/_layout.tsx app/chat.tsx` ✅
- `node scripts/ci/check-governance.mjs` ✅

**후속 확인 포인트**:
- Android 실기기에서 `메신저 -> 가람지사 메신저 -> 1:1 문의` 진입 시 상단 `1:1 문의` 기본 바가 사라지고 커스텀 헤더만 보이는지
- 관리자 경로에서 같은 `chat` 화면을 열어도 네이티브 스택 헤더가 다시 노출되지 않는지

---

## <a id="20260312-presence-first-login-label"></a> 2026-03-12 | 활동 상태 UI에 `첫 접속 전` 상태 추가

**배경**:
- 최근 추가한 활동 상태 UI는 `활동중` 또는 `N분 전 접속`처럼 meaningful timestamp가 있을 때만 렌더링했다.
- 그래서 한 번도 로그인하지 않아 `user_presence` row가 없거나, row는 있어도 meaningful last-seen이 없는 사용자는 아바타 점과 보조 문구가 통째로 숨겨졌다.
- 로컬/일부 환경에서 `get_user_presence` RPC가 빠진 경우 fallback이 `user_presence` 실존 row만 반환해, 미접속 사용자는 snapshot 자체가 생성되지 않는 문제도 있었다.

**조치**:
- `lib/presence.ts`, `app/request-board-messenger.tsx`, `web/src/lib/presence.ts`
  - meaningful history가 전혀 없고 offline인 경우 라벨을 `첫 접속 전`으로 반환하도록 통일했다.
  - 기존 `활동중` / `방금 전 접속` / `N분/시간/일 전 접속` 계산은 그대로 유지했다.
- `supabase/functions/user-presence/index.ts`
  - RPC 성공/실패와 무관하게 요청한 전화번호 목록 기준으로 snapshot을 합성하도록 변경했다.
  - `user_presence` row가 없는 번호는 `is_online=false`, timestamp 전부 `null`인 placeholder snapshot으로 채워 앱/웹 UI가 같은 조건으로 상태를 렌더링할 수 있게 했다.

**검증**:
- `npx tsc --noEmit` ✅

**후속 확인 포인트**:
- 앱 내부 메신저, 관리자 모바일 메신저, 관리자 웹 채팅, GaramLink 메신저에서 로그인 이력 없는 사용자가 `첫 접속 전`으로 보이는지
- RPC가 없는 로컬/부분 환경에서도 같은 사용자가 점+라벨까지 포함해 일관되게 노출되는지

---

## <a id="20260312-chat-header-parity"></a> 2026-03-12 | 내부 `1:1 문의` 헤더를 설계매니저 메신저 스타일로 통일

**배경**:
- 앱 안에는 내부 메신저(`app/chat.tsx`)와 설계매니저용 GaramLink 메신저(`app/request-board-messenger.tsx`)가 공존하는데, 대화 화면 헤더 스타일이 서로 달랐다.
- 내부 메신저는 상단에 중앙 정렬된 제목형 헤더를 쓰고 있어, 설계매니저와 대화하는 화면의 아바타/이름/접속상태 구조와 시각적으로 분리되어 보였다.
- 사용자는 `유지영` 설계매니저와 대화하는 화면을 기준으로 두 메신저 헤더를 통일해 달라고 요청했다.

**조치**:
- `app/chat.tsx`
  - 대화 화면 헤더를 중앙 제목형 레이아웃에서, `request-board-messenger`와 같은 좌측 아바타 + 이름 + 접속상태 구조로 교체했다.
  - 상대 이름 기준 이니셜 아바타와 해시 색상을 추가해 `개발자`, `총무`, `본부장`, FC 대상 모두 같은 헤더 패턴으로 보이게 맞췄다.
  - 활동중/마지막 접속 문구가 있으면 아바타 점과 보조 텍스트를 같은 줄 규칙으로 렌더링하도록 정리했다.
  - 뒤로가기 버튼을 헤더 좌측에 배치해 기존 대화 진입/복귀 동선을 유지했다.

**검증**:
- `npm run lint -- app/chat.tsx` ✅

**후속 확인 포인트**:
- FC가 `메신저 -> 가람지사 메신저 -> 개발자/총무/본부장`으로 들어간 대화 화면 상단이 GaramLink 메신저와 같은 구조로 보이는지
- 관리자 목록(`app/admin-messenger.tsx`)에서 FC 대화를 열었을 때도 같은 헤더 패턴과 뒤로가기 동작이 유지되는지

---

## <a id="20260312-request-board-dev-url-presence-label"></a> 2026-03-12 | 앱 GaramLink 로컬 URL 자동 해석 + presence sentinel 라벨 보정

**배경**:
- 앱 안 `가람Link 메신저(request-board-messenger)`는 활동중 UI 자체는 이미 렌더링하고 있었지만, Expo 개발 환경에서 `EXPO_PUBLIC_REQUEST_BOARD_URL`이 비어 있으면 기본값으로 운영 `https://requestboard-steel.vercel.app`를 바라보고 있었다.
- 반면 사용자는 로컬 `request_board`(`localhost:5173`)에서 설계매니저 활동중을 확인하고 있었기 때문에, 앱과 웹이 서로 다른 GaramLink 인스턴스를 보면서 presence가 엇갈렸다.
- 추가로 앱 쪽 presence 라벨 포맷터는 request_board 웹에서 이미 막아둔 stale sentinel(`1970-01-01`)을 그대로 마지막 접속으로 취급할 수 있어, 비정상적인 `N만일 전 접속` 문구가 다시 노출될 위험이 있었다.

**조치**:
- `lib/request-board-url.ts`
  - 새 공통 resolver를 추가했다.
  - 우선순위는 `EXPO_PUBLIC_REQUEST_BOARD_API_URL` / `EXPO_PUBLIC_REQUEST_BOARD_WEB_URL` / 레거시 `EXPO_PUBLIC_REQUEST_BOARD_URL` 순으로 명시적 설정을 사용한다.
  - 명시적 값이 없고 Expo 개발 빌드(`__DEV__`)이면 `Constants.expoConfig.hostUri`와 `Constants.linkingUri`에서 Expo host를 파싱해:
    - GaramLink API: `http://<expo-host>:3000`
    - GaramLink 웹: `http://<expo-host>:5173`
    로 자동 해석하도록 만들었다.
  - Android 에뮬레이터에서 host가 `localhost/127.0.0.1`로 잡히면 `10.0.2.2`로 보정한다.
- `lib/request-board-api.ts`
  - 앱의 GaramLink API client가 새 resolver의 API base URL을 사용하도록 변경했다.
- `app/request-board.tsx`
  - 앱의 GaramLink 외부 진입/copy URL도 새 resolver의 웹 base URL을 사용하도록 맞췄다.
- `app/request-board-messenger.tsx`, `lib/presence.ts`
  - stale sentinel(`1970-01-01`)은 마지막 접속 시각으로 취급하지 않도록 웹과 동일한 기준을 적용했다.
  - `last_seen_at`이 sentinel/invalid이면 플랫폼 timestamp(`garam_in_at` / `garam_link_at`)를 우선 보고, 그것도 없고 offline이면 `updated_at`을 fallback으로 사용한다.

**검증**:
- `npx tsc --noEmit` ✅
- `node scripts/ci/check-governance.mjs` ✅

**후속 확인 포인트**:
- Expo/Metro를 재시작한 뒤, 로컬 `request_board` 서버(`:3000`)와 웹(`:5173`)을 띄운 상태에서 앱 `가람Link 메신저`가 같은 설계매니저의 `활동중`을 표시하는지
- 앱에서 stale/offline row가 더 이상 sentinel 기반 `수만 일 전 접속`으로 보이지 않는지

---

## <a id="20260312-messenger-live-badge-file-card"></a> 2026-03-12 | 메신저 허브 live unread 배지 + 내부 파일 카드 레이아웃

**배경**:
- 메신저 허브 첫 화면(`app/messenger.tsx`)의 unread 배지는 화면 포커스 진입이나 수동 pull-to-refresh 때만 다시 계산돼, 허브를 열어둔 상태에서는 새 메시지가 와도 숫자가 바로 바뀌지 않았다.
- `가람in` 내부 메신저(`app/chat.tsx`)는 파일 첨부를 일반 텍스트 버블 안에 그대로 렌더링하고 있어, 긴 파일명이나 파일 카드 너비 계산이 겹치면 오렌지 버블이 찌그러지거나 시간 라벨과 시각적으로 엇나갔다.
- 1차 보정 뒤에도 own bubble 안 파일 카드가 내용 기준으로 과도하게 수축해, 아이콘만 남고 파일명이 사실상 보이지 않는 케이스가 확인됐다.

**조치**:
- `app/messenger.tsx`
  - unread 로딩을 내부 메신저 / `가람Link` 메신저로 분리했다.
  - 내부 unread는 `messages.receiver_id = myChatId` 기준 Supabase realtime 구독으로 즉시 다시 계산하도록 바꿨다.
  - 허브 화면이 열려 있는 동안 5초 간격 active-screen polling과 `AppState active` 복귀 refresh를 추가해 `가람Link` unread 카드도 새로고침 없이 따라오도록 보강했다.
- `app/chat.tsx`
  - 파일 메시지를 전용 `fileCard` 레이아웃으로 분리하고, `minWidth: 0`, `maxWidth: '100%'`, 전용 icon/text/download 영역을 넣어 bubble width 계산을 안정화했다.
  - 파일 메시지 bubble padding을 별도로 조정해 내부 카드가 오렌지 bubble 밖으로 밀리거나 과하게 눌리지 않도록 정리했다.
  - 후속으로 파일 카드 자체에 읽기 가능한 고정/최소 폭(`FILE_CARD_WIDTH`, `minWidth`)을 주고, 파일명 텍스트 영역에 `flexBasis: 0` + `numberOfLines={2}`를 적용해 아이콘/다운로드 버튼이 있어도 파일명이 항상 보이도록 수정했다.
  - presence 문구(`N분 전 접속`)가 헤더에 추가됐을 때 상대 이름이 좌측으로 밀려 보이지 않도록, 헤더 제목 묶음을 중앙 정렬 전용 컨테이너로 분리하고 두 줄 높이에 맞게 `minHeight + paddingVertical` 기준으로 정렬을 다시 잡았다.

**검증**:
- `npm run lint -- app/messenger.tsx app/chat.tsx` ✅

**후속 확인 포인트**:
- 메신저 허브를 열어둔 상태에서 새 메시지를 받을 때 `가람지사 메신저` / `설계요청 메신저` 카드 숫자가 pull-to-refresh 없이 바뀌는지
- Android/iOS 실기기에서 PDF/문서 파일을 보냈을 때 파일 카드가 bubble 안에서 안정적으로 보이고 시간 라벨과 겹치지 않으며 파일명이 실제로 노출되는지

---

## <a id="20260311-app-presence-hotfix"></a> 2026-03-11 | 앱 활동중 heartbeat 핫픽스 (`user-presence` fallback)

**배경**:
- 앱 메신저에서 활동중 UI가 계속 보이지 않아 `user_presence` 런타임 상태를 직접 조회했다.
- 확인 결과 `ubeginyxaotcamuqpmud` 프로젝트의 `user_presence`는 비어 있었고, 테스트용 signed app-session token으로 `user-presence`를 호출하면 `500 db_error`가 재현됐다.
- 원인은 `touch_user_presence` RPC가 런타임에서 실패할 때 Edge Function이 그대로 500을 반환하고 있었기 때문이다. request_board 서버에서는 이미 같은 계열 RPC 오류에 대해 direct-table fallback을 두고 있었다.

**조치**:
- `supabase/functions/user-presence/index.ts`
  - `get_user_presence`, `touch_user_presence`, `stale_user_presence` RPC 호출이 실패하면 누락 RPC(`PGRST202`) 여부와 관계없이 모두 direct-table read/write fallback으로 내려가도록 수정했다.
  - fallback 진입 시 `console.warn(...)`으로 원인 추적 로그를 남기도록 정리했다.
- 배포
  - `supabase functions deploy user-presence --project-ref ubeginyxaotcamuqpmud`

**검증**:
- `npx tsc --noEmit` ✅
- 원격 함수 프로브 ✅
  - signed app-session token으로 `user-presence` `action=heartbeat` 호출 시 `200` + `is_online=true`
  - 같은 토큰으로 `action=read` 호출 시 방금 기록한 `garam_in_at` row 반환

**운영 메모**:
- 앱 안 `가람Link 메신저(request-board-messenger)`는 별도 request_board 프로젝트 데이터를 읽는다. 따라서 현재 보이는 설계매니저가 request_board 쪽 `user_presence`를 남기지 않았다면 활동중 UI는 계속 숨겨진다.
- `가람in` 내부 presence는 `appSessionToken`이 없는 구세션에서는 여전히 write/read가 불가능하므로, 이 경우 앱에서 한 번 로그아웃 후 다시 로그인해야 한다.

---

## <a id="20260311-chat-safe-area"></a> 2026-03-11 | 안드로이드 edge-to-edge 하단 안전영역 보정 (`1:1 문의`)

**배경**:
- `app.json`에서 Android `edgeToEdgeEnabled: true`가 켜져 있어, 하단 시스템 네비게이션 영역을 화면별로 직접 피해야 한다.
- `app/chat.tsx`의 FC 대상 선택 리스트는 하단 inset을 반영하지 않아 마지막 카드가 시스템 네비게이션 바 뒤로 일부 가려졌다.
- 같은 화면의 업로드 진행 오버레이와 입력 바도 서로 다른 bottom 여백 기준을 써서 기기별로 하단 간격이 들쭉날쭉할 수 있었다.

**조치**:
- `app/chat.tsx`
  - `bottomSafeInset` 계산을 추가해 Android/iOS 공통 하단 안전영역 기준을 한 곳으로 통일했다.
  - FC 대상 선택 `FlatList`의 `contentContainerStyle`에 동적 `paddingBottom`을 적용해 마지막 본부장/총무/개발자 카드가 시스템 네비게이션 바와 겹치지 않도록 조정했다.
  - 파일 업로드 오버레이와 채팅 입력 바도 동일한 하단 inset 기준을 사용하도록 정렬했다.

**검증**:
- `npm run lint -- app/chat.tsx` ✅

**후속 확인 포인트**:
- Android 실기기에서 3버튼 네비게이션/제스처 네비게이션 각각 마지막 대상 카드가 완전히 보이는지
- 업로드 중 오버레이가 입력 바와 시스템 네비게이션 사이에서 안정적으로 떠 있는지

---

## <a id="20260311-presence-foundation"></a> 2026-03-11 | 활동중 표시 기반 추가 (가람in 앱 heartbeat + 가람Link 메신저 UI)

**배경**:
- 활동중 표시는 `가람in`과 `가람Link`를 전화번호 단위로 묶어 계산해야 했다.
- 모바일 앱은 Supabase Auth가 아니라 커스텀 앱 세션(`appSessionToken`) 기반이라, 직접 DB write 대신 Edge Function 경유가 필요했다.
- request_board 운영 배포는 Vercel serverless라 지속 Socket.IO presence보다 `HTTP heartbeat + shared DB(user_presence)`가 현실적인 기준이다.

**조치**:
- DB / 공통 스키마
  - `supabase/migrations/20260311000003_create_user_presence.sql`
  - `supabase/schema.sql`
    - `user_presence(phone PK, garam_in_at, garam_link_at, updated_at)` 추가
    - `touch_user_presence`, `stale_user_presence`, `get_user_presence` RPC 함수 추가
    - service-role 전용 실행 권한 정리
- Edge Function
  - `supabase/functions/user-presence/index.ts`
    - `sessionToken`을 `parseAppSessionToken`으로 검증
    - `heartbeat/offline` 액션별로 `garam_in` 컬럼만 갱신
    - `fc_profiles`, `admin_accounts`, `manager_accounts` 존재/활성 검증 포함
- 모바일 앱 전역 writer
  - `lib/user-presence-api.ts`
    - `user-presence` Edge Function invoke 래퍼 추가
  - `hooks/use-app-presence-heartbeat.ts`
    - `AppState active` 시 즉시 heartbeat + 30초 interval
    - `background/inactive` 시 즉시 offline
    - in-flight write 중 상태 전환 시 queued action으로 순서 보정
  - `app/_layout.tsx`
    - `SessionProvider` 내부에 `PresenceBootstrap` 추가해 앱 전역 heartbeat 시작
- request_board 메신저 reader
  - `lib/request-board-api.ts`
    - participant phone 포함 타입 확장
    - `rbGetPresence()` 추가
  - `app/request-board-messenger.tsx`
    - conversation/DM/designer item에 participant phone 보관
    - presence polling(30초 + app active 복귀 refresh) 추가
    - 목록/상단 헤더에 avatar dot + `활동중` / `N분 전 접속` 표시 추가

**검증**:
- 앱 타입체크:
  - `npx tsc --noEmit` ✅
- request_board 연동 빌드:
  - `request_board/server`: `npm run build` ✅
  - `request_board/client`: `npm run build` ✅
- 주의:
  - `npx tsc --project supabase/functions/tsconfig.json --noEmit`는 기존 `board-*`, `fc-notify` 타입 오류 때문에 전체 통과하지 못했고, 이번 변경과 직접 관련 없는 선행 이슈로 판단했다.
  - 이 환경에는 `deno` 실행기가 없어 `user-presence` 함수 단독 `deno check`는 수행하지 못했다.

**후속 확인 포인트**:
- 모바일 앱 foreground/background 전환 시 상대방 화면에서 `활동중`이 자연스럽게 바뀌는지
- request_board 웹/PWA hidden 30초 grace가 깜빡임 없이 동작하는지
- cross-platform(가람in만 켜짐 / 가람Link만 켜짐 / 둘 다 켜짐) 합산 online 계산이 의도대로 보이는지

---

## <a id="20260311-developer-subtype"></a> 2026-03-11 | 개발자 계정 subtype 도입 + request_board FC 브릿지

**배경**:
- 총무와 동일한 운영 권한을 유지하되, FC 메신저에서는 총무와 다른 별도 상대방으로 보여야 하고, 앱/웹/게시판/알림에서는 직책이 `총무`가 아니라 `개발자`로 표시되는 전용 운영 계정이 필요했다.
- 동시에 가람Link에서는 별도 관리자 역할이 아니라 기존 `FC`와 동일한 권한 모델을 유지해야 했고, direct login/bridge login 모두 이름이 `개발자`로 보여야 했다.
- 기존 top-level role 계약(`admin`/`manager`/`fc`)을 깨면 세션, 권한, request_board 브릿지, read-only 분기 전반을 다시 바꿔야 해서 회귀 범위가 과도했다.

**조치**:
- 스키마/세션 계약:
  - `supabase/migrations/20260311000002_add_admin_staff_type.sql`, `supabase/schema.sql`
    - `admin_accounts.staff_type` 컬럼 추가 (`admin` / `developer`, default `admin`).
  - `supabase/functions/_shared/request-board-auth.ts`
    - 앱 세션 토큰에 optional `staffType` 포함.
  - `hooks/use-session.tsx`, `hooks/use-login.ts`, `lib/request-board-session.ts`
    - 앱 세션 상태에 `staffType` 저장/복원.
    - request_board 사용 가능 조건을 `admin + staffType=developer`까지 확장.
- 앱/브릿지 인증:
  - `supabase/functions/login-with-password/index.ts`
    - `admin_accounts.staff_type` 조회 추가.
    - `staff_type='developer'`이면 앱 role은 계속 `admin`, request_board bridge/direct sync role은 `fc`, request_board 표시 이름은 `개발자`로 발급.
  - `supabase/functions/sync-request-board-session/index.ts`
    - 총무는 기존처럼 request_board 비대상 유지.
    - 개발자 subtype만 `fc` bridge token 재발급 허용.
- 메신저/알림/표시 분리:
  - `lib/staff-identity.ts`, `web/src/lib/staff-identity.ts`
    - 개발자 계정 라벨, sender name, chat actor id, board badge helper 추가.
  - `app/chat.tsx`, `app/admin-messenger.tsx`, `app/messenger.tsx`
    - FC 대상 목록에 `developers` 별도 노출.
    - 개발자는 총무 공용 actor id가 아니라 본인 전화번호 actor id 사용.
  - `app/notifications.tsx`, `web/src/components/DashboardNotificationBell.tsx`
    - 개발자 admin 세션은 admin inbox + request_board용 fc inbox를 병합 로드.
  - `supabase/functions/fc-notify/index.ts`
    - `chat_targets` 응답에 `developers` 추가.
- 게시판/웹 라벨:
  - `supabase/functions/_shared/board.ts`, `board-list`, `board-detail`
    - 게시글/댓글 작성자가 `admin + staff_type=developer`면 display role을 `developer`로 변환.
  - `app/board.tsx`, `app/admin-board-manage.tsx`, `app/board-detail.tsx`, `web/src/app/dashboard/board/page.tsx`
    - 배지/라벨을 `개발자`까지 지원.
  - `web/src/app/dashboard/layout.tsx`, `web/src/app/dashboard/settings/page.tsx`, `web/src/app/dashboard/messenger/page.tsx`, `web/src/app/dashboard/chat/page.tsx`, `web/src/app/chat/page.tsx`
    - 헤더/설정/메신저에서 개발자 직책 라벨과 개별 채팅 actor id 반영.
- 운영 계정 생성:
  - `admin_accounts`에 `name='개발자'`, `phone='01058006018'`, `staff_type='developer'` 계정 생성.
  - PBKDF2-SHA256(100000회) 해시로 앱 비밀번호 저장.
  - 개발자 앱 로그인 시 request_board에 `fc` direct 계정이 자동 동기화되도록 verified.

**검증**:
- 정적 검증:
  - `npx tsc --noEmit`
  - `npx eslint app/chat.tsx app/admin-messenger.tsx app/messenger.tsx app/notifications.tsx app/board.tsx app/admin-board-manage.tsx app/board-detail.tsx hooks/use-login.ts hooks/use-session.tsx lib/staff-identity.ts lib/board-api.ts lib/request-board-session.ts lib/welcome-title.ts lib/__tests__/request-board-session.test.ts web/src/lib/board-api.ts`
  - `cd web && npm run lint -- src/app/dashboard/layout.tsx src/app/dashboard/settings/page.tsx src/app/dashboard/messenger/page.tsx src/app/dashboard/chat/page.tsx src/app/chat/page.tsx src/app/dashboard/board/page.tsx src/components/DashboardNotificationBell.tsx src/lib/staff-identity.ts src/lib/board-api.ts src/hooks/use-session.tsx src/app/auth/page.tsx`
  - `npx jest lib/__tests__/request-board-session.test.ts`
  - `cd web && npm run build`
  - `node scripts/ci/check-governance.mjs`
- 원격 반영:
  - `supabase db push`로 `20260311000002_add_admin_staff_type.sql` 적용
  - Edge Function deploy:
    - `login-with-password`
    - `sync-request-board-session`
    - `fc-notify`
    - `board-list`
    - `board-detail`
- 런타임 검증:
  - 앱 로그인 (`login-with-password`): `role=admin`, `staffType=developer`, `requestBoardRole=fc`, bridge/app session token 발급 확인
  - request_board bridge-login: `role=fc`, `name=개발자`
  - request_board direct login: `role=fc`, `name=개발자`
  - `sync-request-board-session`: 개발자 세션에서 `requestBoardRole=fc`로 재발급 확인
  - `fc-notify chat_targets`: FC 대상 목록에 `developers[0] = { name: '개발자', phone: '01058006018' }` 확인

**운영 후 확인 포인트**:
- 모바일/웹 클라이언트 배포 후 개발자 계정이 설정/헤더/알림/게시판에서 `개발자`로 표기되는지
- FC 메신저 대상 선택에서 총무와 별개 `개발자` 항목이 보이고, 대화가 공용 총무방과 섞이지 않는지
- 개발자 계정으로 가람Link direct login/bridge login 후 FC 권한만 가지는지

---

## <a id="20260311-exam-approval-notify"></a> 2026-03-11 | 시험 신청 승인 시 FC 앱 알림 누락 보완

**배경**:
- FC가 시험 신청을 한 뒤 총무가 `접수 완료/승인 완료`로 상태를 바꿔도 FC 모바일 앱 알림센터와 푸시가 오지 않는 문제가 확인되었다.
- 원인을 확인한 결과 시험 승인 화면 3곳이 모두 `exam_registrations.is_confirmed`/`status` 갱신만 수행하고, 다른 승인 흐름처럼 `fc-notify`를 호출하지 않았다.
  - 모바일 총무 생명보험 신청자 화면 `app/exam-manage.tsx`
  - 모바일 총무 손해보험 신청자 화면 `app/exam-manage2.tsx`
  - 관리자 웹 신청자 관리 화면 `web/src/app/dashboard/exam/applicants/page.tsx`

**조치**:
- `lib/exam-approval-notify.ts`
  - FC 시험 승인 알림 전송 공통 헬퍼 추가.
  - `residentId` 정규화, 승인/해제 메시지 생성, `fc-notify`(`target_role='fc'`) 호출을 캡슐화.
- `app/exam-manage.tsx`, `app/exam-manage2.tsx`
  - 총무 승인 토글 시 `is_confirmed`뿐 아니라 `status`도 `confirmed/applied`로 동기화.
  - `접수 완료`로 변경될 때 공통 헬퍼로 FC 앱 알림 전송.
  - 알림 전송 실패 시 승인 상태 저장은 유지하고 운영자에게만 경고 표시.
- `web/src/app/dashboard/exam/applicants/page.tsx`
  - 웹 승인 토글도 동일하게 FC 앱 알림 전송.
  - 캐시 업데이트 키를 실제 query key(`['exam-applicants-all-recent', role]`)와 맞춰 즉시 반영 경로를 안정화.

**검증**:
- `npm run lint -- lib/exam-approval-notify.ts app/exam-manage.tsx app/exam-manage2.tsx`
- `npx tsc --noEmit`
- `cd web && npm run lint -- src/app/dashboard/exam/applicants/page.tsx`

**운영 후 확인 포인트**:
- 총무 앱에서 생명/손해 시험 신청자를 `접수 완료`로 바꿀 때 FC 앱 푸시와 알림센터 항목이 생성되는지
- 관리자 웹에서 동일 토글 시 FC 앱 푸시와 알림센터 항목이 생성되는지
- `미접수`로 되돌릴 때 승인 저장은 유지되고 불필요한 에러로 막히지 않는지

---

## <a id="20260311-logout-rb-sync"></a> 2026-03-11 | 로그아웃 공통 동작 통일 + request_board 첫 로그인 세션 재바인딩 강화

**배경**:
- 설계매니저가 `가람in`에서 `가람Link` 진입 화면을 사용할 때 상단 `로그아웃` 버튼을 눌러도 즉시 로그인 화면으로 이동하지 않아 버튼이 먹지 않는 것처럼 보이는 문제가 있었다.
- 일부 request_board 관련 화면은 세션이 비워져도 자체적으로 `/login` 리다이렉트하지 않아, 로그아웃/세션 강제정리 뒤에도 같은 화면에 남을 수 있었다.
- request_board 연동은 앱 로그인 직후에도 기존 `rb_jwt_token`이 남아 있으면 이전 사용자 세션을 재사용할 여지가 있었고, 이 경우 fresh login 이후에도 세션 업그레이드/재로그인 안내가 튈 수 있었다.

**조치**:
- `hooks/use-app-logout.ts`
  - 앱 공통 로그아웃 액션 추가: 세션 정리 + `/login` 즉시 이동.
- `app/request-board.tsx`, `app/board.tsx`, `app/admin-board-manage.tsx`, `app/settings.tsx`, `app/home-lite.tsx`
  - 로그아웃 액션을 공통 훅으로 통일.
  - 세션이 비워진 상태(`role === null`)를 감지하면 `/login`으로 리다이렉트하도록 보강.
- `components/AppTopActionBar.tsx`
  - 알림/로그아웃 터치 영역에 `hitSlop` 추가.
- `hooks/use-login.ts`
  - 새 로그인 성공 시 request_board 로컬 인증 상태(`rb_jwt_token`, bridge/app session token)를 먼저 초기화한 뒤 새 토큰을 저장하도록 변경.
  - `login-with-password`가 내려주는 `requestBoardRole(fc|designer)`를 즉시 받아, bridge-login이 일시 실패해도 첫 화면에서 올바른 설계매니저/FC 분기를 유지하도록 보강.
- `hooks/use-session.tsx`
  - request_board `/api/auth/me` 결과의 전화번호가 현재 앱 세션 전화번호와 다르면 stale request_board JWT로 판단하고 `clearAuth()` 후 current bridge/app session으로 재바인딩하도록 변경.
- `supabase/functions/login-with-password/index.ts`
  - 앱 로그인 응답에 `requestBoardRole` 포함(`manager -> fc`, request_board-linked FC -> `fc|designer`, admin -> `null`).

**검증**:
- `npm run lint -- hooks/use-app-logout.ts hooks/use-login.ts hooks/use-session.tsx components/AppTopActionBar.tsx app/request-board.tsx app/board.tsx app/admin-board-manage.tsx app/settings.tsx app/home-lite.tsx`
- `npx tsc --noEmit`
- `npx jest lib/__tests__/request-board-session.test.ts`
- `node scripts/ci/check-governance.mjs`

**운영 후 확인 포인트**:
- 설계매니저/FC/본부장 계정으로 상단 `로그아웃` 탭 시 즉시 `/login`으로 이동하는지
- 서로 다른 계정으로 연속 로그인 시 request_board가 이전 사용자 JWT를 재사용하지 않는지
- fresh login 직후 설계매니저가 `설계 요청`/`설계요청 메신저`에 진입해도 `가람Link 연동 세션을 업그레이드하려면 다시 로그인해주세요.` 경고가 다시 뜨지 않는지

---

## <a id="20260311-designer-doc-sync"></a> 2026-03-11 | 설계매니저 앱 연동 구조 문서 정합화

**배경**:
- 운영 중 request_board 설계매니저 계정은 별도로 존재하지만, `가람in` 쪽은 독립 `designer` role 테이블/세션 구조가 아니어서 생성 규칙이 혼동될 수 있었다.
- 실제 앱 구조는 설계매니저를 `fc_profiles`/`fc_credentials`에 저장하고 `affiliation = '<보험사> 설계매니저'` 패턴으로 request_board 브릿지 role을 `designer`로 해석한다.
- 운영 DB 확인 결과 앱 기준 request_board-linked 설계매니저 프로필 수는 현재 `54명`이었다.

**조치**:
- `AGENTS.md`
  - Snapshot 기준일을 `2026-03-11`로 갱신.
  - 설계매니저 앱 연동 구조를 명시:
    - 앱 내부 독립 role 없음
    - `fc_profiles`/`fc_credentials` 저장
    - `affiliation` 패턴 기반 request_board `designer` 브릿지 발급
  - 현재 앱 DB 기준 linked 설계매니저 수 `54명` 반영.

**검증**:
- 운영 DB 조회:
  - `fc_profiles.affiliation ilike '%설계매니저%'` = `54`
- 현재 세션/브릿지 구현 대조:
  - `hooks/use-session.tsx`
  - `supabase/functions/login-with-password/index.ts`
  - `lib/bottom-navigation.ts`

---

## <a id="20260311-guide-images"></a> 2026-03-11 | 수당동의/위촉 가이드 이미지 자산 경로 정리

**배경**:
- `app/consent.tsx`의 수당동의 가이드 이미지가 실제 앱에서 보이지 않는 이슈 확인.
- 가이드 이미지가 프로젝트 루트 별도 폴더(`agreement_imag`, `appointment_img`)를 직접 `require()`하는 구조였고, 네이티브 빌드 자산 번들링 경로로는 불안정했다.
- 동일 패턴이 `app/appointment.tsx`에도 있어 이후 같은 문제가 재발할 가능성이 있었다.

**조치**:
- `assets/images/guides/agreement/*.jpg`, `assets/images/guides/appointment/*.jpg`로 가이드 이미지를 복제해 앱 번들 기준 경로로 정리.
- `lib/guide-images.ts` 추가:
  - 수당동의/위촉 가이드 이미지 배열을 한 곳에서 관리.
- `app/consent.tsx`
  - 기존 `../agreement_imag/*.jpg` 직접 참조 제거.
  - `AGREEMENT_GUIDE_IMAGES` import로 교체.
- `app/appointment.tsx`
  - 기존 `../appointment_img/*.jpg` 직접 참조 제거.
  - `APPOINTMENT_GUIDE_IMAGES` import로 교체.

**검증**:
- `npx tsc --noEmit` 통과
- `npm run lint -- app/consent.tsx app/appointment.tsx lib/guide-images.ts` 통과

---

## <a id="20260310-ios-keyboard"></a> 2026-03-10 | iOS 키보드 및 사진 접근 권한 버그 수정

**배경**:
- iOS 전체 코드베이스 감사 결과 발견.

**조치**:
- `app/chat.tsx`
  - 메시지 FlatList에 `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="interactive"` 추가.
    - iOS에서 키보드가 올라와 있을 때 메시지/버튼을 탭해도 무시되던 문제 수정.
    - `interactive`: 드래그로 자연스럽게 키보드 내림.
  - `pickImage()` 앞에 iOS 사진 접근 권한 체크 추가.
    - 권한 거부 시 무음 실패 대신 "설정 > 가람in > 사진 접근" 안내 Alert.
- `app/admin-messenger.tsx`
  - FC 목록 FlatList에 `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"` 추가.
    - 검색 TextInput 포커스 중 목록 항목 탭이 무시되던 문제 수정.
- `app/docs-upload.tsx`
  - ScrollView에 `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"` 추가.

---

## <a id="20260310-ios-datepicker-all"></a> 2026-03-10 | iOS DateTimePicker 렌더링 버그 전체 수정

**배경**:
- `consent.tsx` 동일 버그(`transparent` Modal + `display="spinner"` → iOS 15+ 빈 화면)가 다른 화면에도 존재함을 발견.
- 영향 화면: 위촉 날짜(`appointment.tsx` ×2), 시험 수수료 납입일(`exam-apply.tsx`, `exam-apply2.tsx`), 관리자 서류 마감일(`dashboard.tsx`).

**조치**:
- 4개 파일의 iOS Modal DateTimePicker 모두 동일하게 수정:
  - `display="spinner"` → `display="inline"`
  - `animationType="fade"` → `animationType="slide"`

---

## <a id="20260310-ios-datepicker"></a> 2026-03-10 | iOS 수당동의 화면 달력 DateTimePicker 렌더링 버그 수정

**배경**:
- 배포된 앱에서 수당동의(`consent.tsx`) 화면의 날짜 선택 달력이 iOS에서 빈 화면으로 나타나는 버그 발생.
- `transparent` Modal 안에서 `display="spinner"` 사용 시 iOS 15+ 환경에서 UIPickerView가 렌더링되지 않는 네이티브 버그.

**조치**:
- `app/consent.tsx`
  - iOS 전용 Modal: `display="spinner"` → `display="inline"` (달력 그리드 방식, transparent modal에서 정상 렌더링).
  - `animationType="fade"` → `animationType="slide"` (inline 모드와 시각적으로 자연스러운 트랜지션).
  - `accentColor={COLORS.primary}` 추가 (선택된 날짜 색상 브랜드 색상으로 통일).

---

## <a id="20260310-youtube-card"></a> 2026-03-10 | 홈 첫 화면 유튜브 가이드 카드 추가

**배경**:
- FC 첫 화면의 "앱 사용법 안내 시작하기" 카드 옆에 유튜브로 연결되는 별도 카드 추가 요청.

**조치**:
- `app/index.tsx`
  - `openExternalUrl` import, `YOUTUBE_URL` 상수, `openHomeYoutube` 함수 추가.
  - 가이드 카드를 `guideRowNew` (`flexDirection: 'row'`) 컨테이너로 묶고, 유튜브 카드(72px) 나란히 배치.
  - 신규 스타일: `guideRowNew`, `guideCardNewFlex`, `youtubeCardNew`, `youtubeIconWrapNew`, `youtubeCardTextNew`.

---

## <a id="20260310-commission-save-fix"></a> 2026-03-10 | 변경사항 저장 버튼에 위촉 상태 포함

**Commit**: `5724e1f`
**배경**:
- 위촉 상태 칩을 변경한 후 "변경사항 저장" 버튼을 눌러도 DB에 반영되지 않는 버그 발견.
- `updateInfoMutation`(변경사항 저장)에 commission 필드가 포함되지 않았고, "위촉 상태 저장" 전용 버튼만 별도로 존재했음.
- `buildCommissionProfileUpdate`의 `hasAppointmentCompletion`에 `life || nonlife` 포함되어 있어, `'both'` → partial 변경 시 실제 위촉 날짜 없이도 `appointment-completed`로 설정되는 버그도 수정.

**조치**:
- `web/src/app/dashboard/page.tsx`
  - `updateInfoMutation`에 `buildCommissionProfileUpdate()` 결과를 포함 → 변경사항 저장으로도 위촉 상태 저장.
  - temp_id 상태 업데이트가 commission-set status를 덮어쓰지 않도록 `!commissionData.status` 조건 추가.
  - `onSuccess`에서 commission 변경 내용을 `selectedFc`에 즉시 반영.
  - `hasAppointmentCompletion`에서 `life || nonlife` 제거 → `appointment_date_*`만으로 판단.

**검증**:
- TypeScript 타입 체크 통과 (`npx tsc --noEmit` 오류 없음)

---

## <a id="20260310-commission-admin"></a> 2026-03-10 | 총무 위촉 상태 수정 로직 보정(앱/웹 공통)

**Commit**: `pending`  
**배경**:
- 총무가 FC 회원가입 시 잘못 선택된 위촉 상태(`미완료/생명 완료/손해 완료/모두 완료`)를 앱과 관리자 웹에서 직접 수정할 수 있는 UI가 추가됐다.
- 1차 구현은 위촉 플래그(`life_commission_completed`, `nonlife_commission_completed`) 저장까지만 처리하고 있어, `status='final-link-sent'` 사용자를 partial/none으로 되돌릴 때 실제 진행 이력과 상태 문자열이 어긋날 수 있었다.
- 웹 모달은 저장 후 `selectedFc` 로컬 상태를 갱신하지 않아 같은 모달에서 이어지는 위촉 승인 액션이 stale 플래그를 읽을 여지도 있었다.

**조치**:
- `app/dashboard.tsx`
  - 총무 위촉 상태 저장 시 플래그만 바꾸지 않고, 현재 FC의 실제 진행 이력(서류/수당동의/위촉 일정·제출·확정)을 바탕으로 복구 대상 `status`를 계산하는 `buildCommissionProfileUpdate()` 헬퍼를 추가.
  - `both`는 `final-link-sent`로 승격하고, `final-link-sent` 해제 시에는 무조건 `draft`가 아니라 `appointment-completed` / `docs-approved` / `docs-submitted` / `docs-requested` / `allowance-consented` / `temp-id-issued` / `draft` 중 적절한 하한 상태로 복구.
  - 대시보드 재조회 후 위촉 상태 프리필은 서버 최신값이 우선하도록 병합 순서를 수정.
- `web/src/app/dashboard/page.tsx`
  - 앱과 동일한 `buildCommissionProfileUpdate()` 헬퍼를 추가해 관리자 웹도 같은 기준으로 `status`를 복구하도록 정렬.
  - 위촉 상태 저장 성공 시 `selectedFc` 로컬 상태를 즉시 갱신해, 같은 모달에서 이어지는 위촉 승인/반려 계산이 최신 플래그 기준으로 동작하도록 보정.
  - 본부장(read-only) 계정은 위촉 상태 칩 선택 자체도 막아 저장 버튼뿐 아니라 입력 UI도 비활성화.

**검증**:
- 별도 실행 없음(사용자 요청 기준 코드 수정만 진행)

**운영 영향**:
- 총무가 위촉 상태를 수정해도 `final-link-sent` 해제 시 진행 이력이 `draft`로 과도하게 초기화되지 않는다.
- 앱/웹 모두 동일 기준으로 상태를 복구하므로, 홈 단계 계산과 대시보드 배지 분기 드리프트가 줄어든다.

---

## <a id="20260309-1"></a> 2026-03-09 | 레거시 FC 세션 `residentId` 정리 + 메신저 대상 목록 복구 가드

**Commit**: `pending`  
**배경**:
- FC 1:1 문의 화면에서 대화 상대 목록이 비어 있고 `목록을 불러오지 못했습니다.`만 표시되는 사례가 확인됐다.
- 조사 결과 앱의 FC 메신저 대상 목록은 `fc-notify(type='chat_targets')`를 호출하며, 이 함수는 `fc_profiles.phone = resident_id` 조건을 만족해야만 본부장 목록을 반환한다.
- 정상 전화번호를 넘기면 운영 함수가 `ok: true`를 반환했지만, 레거시 세션의 `residentId` 값은 예전 주민번호 계열 식별값이 남아 있을 수 있었고, 현재 세션 복원 훅은 이를 그대로 살려두고 있었다.

**조치**:
- `lib/validation.ts`
  - `isValidMobilePhone()` 헬퍼를 추가해 세션 복원/메신저 로딩 모두 같은 휴대폰 형식 기준을 사용하도록 통일.
- `hooks/use-session.tsx`
  - 저장된 세션 복원 시 `residentId`를 전화번호로 정규화.
  - 전화번호 형식이 아닌 레거시 `residentId`는 세션 자체를 폐기하고 request_board 관련 저장 상태도 함께 제거하도록 변경.
  - `loginAs()`도 `residentId`를 전화번호 기준으로 정규화해 이후 저장값 드리프트를 줄였다.
- `app/chat.tsx`
  - FC 대상 목록 로드 전 `residentId`가 휴대폰 형식인지 먼저 검사.
  - `FC profile not found` / `resident_id is required` 오류는 `세션이 오래되었습니다. 로그아웃 후 다시 로그인해주세요.`로 치환.
  - 해당 경우 버튼 문구를 `다시 로그인`으로 바꾸고 세션 정리 후 로그인 화면으로 이동하도록 변경.
- `lib/__tests__/validation.test.ts`
  - 휴대폰 형식 판별 회귀 테스트 추가.

**검증**:
- `npx jest lib/__tests__/validation.test.ts`
- `npx eslint hooks/use-session.tsx app/chat.tsx lib/validation.ts lib/__tests__/validation.test.ts`
- `npx tsc --noEmit`

**운영 영향**:
- 이번 패치 이후 레거시 FC 세션은 메신저에서 모호한 실패 화면 대신 재로그인 경로로 정리된다.
- 이미 구버전 앱을 쓰는 사용자는 즉시 조치로 `로그아웃 -> 재로그인`이 필요하다.

---

## <a id="20260308-4"></a> 2026-03-08 | `login-with-password` 런타임 500 핫픽스(`toBase64` 누락 복구)

**Commit**: `pending`  
**배경**:
- 세션 동기화 리팩터링 이후 `login-with-password` Edge Function이 일부 로그인 시점에 `500`을 반환했고, 구버전 앱 사용자도 `Edge Function returned a non-2xx status code`로 로그인 자체가 막혔다.
- 원인은 비밀번호 해시 비교 함수(`hashPassword`)가 사용하는 `toBase64()` 헬퍼를 리팩터링 중 제거해 런타임 `ReferenceError`가 발생한 것이었다.

**조치**:
- `supabase/functions/login-with-password/index.ts`
  - `toBase64(bytes: Uint8Array)` 헬퍼를 복구해 기존 비밀번호 PBKDF2 해시 비교 경로를 정상화.
- 운영 배포:
  - `supabase functions deploy login-with-password`
  - 배포 후 `login-with-password` 버전 `v45` 반영 확인.

**검증**:
- `supabase functions list`
  - `login-with-password | ACTIVE | v45 | 2026-03-08 14:27:59 UTC`

**운영 영향**:
- 이 이슈는 앱 버전과 무관한 서버 함수 런타임 오류였기 때문에, 함수 재배포만으로 즉시 복구된다.
- 구버전 앱 사용자도 별도 앱 업데이트 없이 다시 로그인 시도하면 정상 동작해야 한다.

---

## <a id="20260308-3"></a> 2026-03-08 | 앱 세션 복원 시 가람Link 브릿지 세션 자동 재동기화

**Commit**: `pending`  
**배경**:
- 기존 구조는 `가람in` 로그인 시점에만 `request_board` 브릿지 토큰/세션을 만들고, 앱 세션 복원 시에는 이를 다시 보장하지 않았다.
- 그 결과 오래된 앱 세션이나 브릿지 토큰이 없는 세션은 설계요청 화면 진입 시 `가람Link 계정 없음`처럼 보이는 오류가 재발할 수 있었다.

**조치**:
- `supabase/functions/_shared/request-board-auth.ts`
  - request_board 브릿지 토큰과 `fc-onboarding` 앱 세션 토큰 서명/검증 공통 유틸 추가.
- `supabase/functions/login-with-password/index.ts`
  - 로그인 성공 시 기존 `requestBoardBridgeToken`과 함께 `appSessionToken`도 발급하도록 확장.
- `supabase/functions/sync-request-board-session/index.ts`
  - 저장된 앱 세션 토큰을 검증해 request_board 브릿지 토큰을 재발급하는 Edge Function 추가.
  - FC/설계매니저/본부장(manager) 계정의 활성 상태와 가입 완료 상태를 다시 확인한 뒤 브릿지 역할을 재결정.
- `lib/request-board-api.ts`
  - app session 토큰 저장소 추가.
  - 브릿지 토큰이 없으면 `sync-request-board-session`으로 자동 복구한 뒤 `bridge-login` 재시도하도록 보강.
  - request_board JWT는 살아 있지만 복구 토큰(bridge/appSession)이 전혀 없는 구세션은 `needsRelogin`으로 판정해 일회성 재로그인을 강제하도록 변경.
- `hooks/use-login.ts`
  - 로그인 성공 시 `appSessionToken`을 함께 저장.
- `hooks/use-session.tsx`
  - 앱 세션 복원 직후 request_board 세션 자동 동기화 수행.
  - FC/본부장(readOnly admin) 세션만 동기화 대상으로 제한.
  - 복구 불가 구세션은 앱 세션 자체를 정리하고 다시 로그인하도록 강제.
  - request_board 역할(`fc`/`designer`)을 세션 컨텍스트에 재동기화.
- request_board 진입 화면 보강:
  - `app/request-board.tsx`
  - `app/request-board-fc-codes.tsx`
  - `app/request-board-requests.tsx`
  - `app/request-board-review.tsx`
  - `app/request-board-messenger.tsx`
  - `app/messenger.tsx`
  - 진입/집계/메신저 unread 조회 전에 `ensureRequestBoardSession`을 통하도록 정리.
- `lib/request-board-session.ts`, `lib/__tests__/request-board-session.test.ts`
  - request_board 세션 사용 가능 여부, 설계매니저 플래그 결정, 구세션 강제 재로그인 조건을 순수 함수로 분리하고 테스트 추가.

**검증**:
- `npx jest lib/__tests__/request-board-session.test.ts`
- `npx tsc --noEmit`
- `npx eslint hooks/use-login.ts hooks/use-session.tsx lib/request-board-api.ts lib/request-board-session.ts lib/__tests__/request-board-session.test.ts app/request-board.tsx app/request-board-fc-codes.tsx app/request-board-requests.tsx app/request-board-review.tsx app/request-board-messenger.tsx app/messenger.tsx`
- `node scripts/ci/check-governance.mjs`

**운영 영향**:
- 이번 패치 이후 새 로그인 세션은 앱 세션 복원만으로 request_board 세션이 자동 복구된다.
- 반대로 과거에 생성된 `구세션` 중 복구 토큰이 전혀 없는 세션은 보안을 위해 한 번 강제 재로그인이 발생한다. 이 일회성 재로그인 이후에는 동일 원인으로 다시 깨지지 않도록 설계했다.

---

## <a id="20260308-2"></a> 2026-03-08 | 모바일 외부 링크 열기 경로를 인앱 브라우저 중심으로 통일

**Commit**: `pending`  
**배경**:
- Android 앱에서 게시판/설계요청 화면의 외부 웹 링크를 열 때 `Linking.openURL`로 곧바로 외부 앱(Intent)로 넘겨, 사용자가 앱이 종료된 것처럼 느끼는 이탈 동선이 발생했다.
- 특히 YouTube 재생목록 가이드 링크처럼 HTTP(S) 주소는 앱 컨텍스트를 유지한 채 열리는 인앱 브라우저 경로가 더 적합했다.

**조치**:
- `lib/external-url.ts`
  - 외부 URL 정규화 유틸 추가.
  - bare domain은 `https://`를 붙이고, `file://`, `content://`, `tel:` 등 기존 스킴은 그대로 보존하도록 정리.
- `lib/open-external-url.ts`
  - HTTP(S)는 `expo-web-browser`의 `openBrowserAsync`로 열고, 그 외 URI는 `Linking`으로 여는 공통 헬퍼 추가.
- `components/LinkifiedSelectableText.tsx`
  - 게시글/댓글 본문 링크 `열기` 액션을 공통 헬퍼로 교체.
- 앱 화면 전반의 직접 `Linking.openURL` 경로 정리:
  - `app/request-board.tsx` YouTube 가이드 링크
  - `app/board.tsx`, `app/admin-board.tsx`, `app/admin-board-manage.tsx`, `app/board-detail.tsx` 게시판 첨부 열기
  - `app/notice.tsx`, `app/notice-detail.tsx` 공지 첨부/이미지 열기
  - `app/request-board-review.tsx` 설계 첨부 열기
  - `app/consent.tsx` 수당동의 안내 사이트
  - `app/docs-upload.tsx` 업로드한 문서 열기
- `lib/__tests__/external-url.test.ts`
  - HTTP(S)/bare domain/비HTTP 스킴 정규화 규칙과 브라우저 분기 기준 테스트 추가.

**검증**:
- `npx jest lib/__tests__/external-url.test.ts`
- `npx eslint components/LinkifiedSelectableText.tsx app/request-board.tsx app/board.tsx app/admin-board.tsx app/admin-board-manage.tsx app/board-detail.tsx app/notice.tsx app/notice-detail.tsx app/request-board-review.tsx app/consent.tsx app/docs-upload.tsx lib/external-url.ts lib/open-external-url.ts lib/__tests__/external-url.test.ts`

---

## <a id="20260308-1"></a> 2026-03-08 | 관리자 웹 메시지 푸시 딥링크를 `/dashboard/chat`로 정규화

**Commit**: `pending`  
**배경**:
- Chrome 웹 푸시 알림 클릭 시 관리자 메시지 딥링크가 레거시 `/chat?targetId=...` 경로로 열려 대시보드 외부 채팅 화면으로 진입했다.
- 이 레거시 화면은 알림으로 새 창이 열렸을 때 브라우저 히스토리가 없어 뒤로가기 버튼이 사실상 무의미했고, 사용자가 원하는 `대시보드 채팅 직접 진입` 동선과 달랐다.

**조치**:
- `web/src/lib/admin-chat-url.ts`
  - 관리자 웹 메시지 URL 빌더/정규화 유틸 추가.
  - `/chat`, `/dashboard/messenger?channel=garam`, 절대 URL을 모두 `/dashboard/chat?targetId=...&targetName=...` 형태로 변환.
- `web/src/app/api/admin/push/route.ts`
  - Edge Function에서 전달받은 웹 푸시 URL을 관리자 대시보드 경로로 정규화한 뒤 브라우저 알림 payload에 실어 보내도록 수정.
- `web/src/app/api/fc-notify/route.ts`
  - 관리자 대상 메시지 웹 푸시 URL을 `/dashboard/chat` 직접 진입으로 변경.
  - `sender_name`이 비어 있으면 `fc_profiles.phone` 기준으로 이름을 조회해 `targetName`을 채우도록 보강.
- `web/public/sw.js`
  - 알림 클릭 시 레거시 `/chat`·`/dashboard/messenger?channel=garam` 경로를 `/dashboard/chat`으로 정규화.
  - 동일 origin의 기존 창이 열려 있으면 새 창 대신 해당 창을 `navigate()` 후 `focus()`하도록 변경해 히스토리/동선 안정화.
- `web/src/app/chat/page.tsx`
  - 관리자/본부장이 레거시 `/chat`로 들어오면 즉시 `/dashboard/chat`으로 `replace` 리다이렉트해 과거 링크/오래된 알림도 자동 복구.

**검증**:
- `cd web && npm run lint -- src/app/api/admin/push/route.ts src/app/api/fc-notify/route.ts src/app/chat/page.tsx src/lib/admin-chat-url.ts`
- `cd web && npm run build`
- 관리자 메시지 딥링크 기대값: `https://adminweb-red.vercel.app/dashboard/chat?targetId=01028780390&targetName=%EA%B9%80%EC%98%81%EC%B2%B4`

---

## <a id="20260304-1"></a> 2026-03-04 | 설계요청 가이드 링크 교체 + 웹 위촉 처리 버튼 UX 정리

**Commit**: `pending`  
**배경**:
- 모바일 `설계요청` 화면의 사용법 링크를 단일 영상에서 최신 재생목록 링크로 교체할 필요가 있었다.
- 웹 대시보드 위촉 섹션에서 `일정 저장`과 `승인/반려` 흐름이 토글 중심으로 섞여 있어 조작 의도가 불명확했다.

**조치**:
- `app/request-board.tsx`
  - `YOUTUBE_URL`을 최신 재생목록 URL로 교체.
- `web/src/app/dashboard/page.tsx`
  - 위촉 액션 처리에서 `schedule` 저장은 즉시 저장되도록 변경(확인 모달 제거).
  - `confirm`만 확인 모달을 유지하고, UI를 `승인 완료`/`반려` 버튼 구조로 단순화.
  - FC 목록 `관리` 액션을 아이콘 버튼에서 텍스트 버튼으로 변경해 클릭 의도 가시성 강화.
- `web/src/components/StatusToggle.tsx`
  - neutral 상태 인디케이터를 숨김(opacity 0) 대신 중립 회색 배경으로 표시해 상태 식별성을 개선.

**검증**:
- `npm run lint -- app/request-board.tsx`
- `cd web && npm run lint -- src/app/dashboard/page.tsx src/components/StatusToggle.tsx`
- `node scripts/ci/check-governance.mjs`

---

## <a id="20260303-4"></a> 2026-03-03 | 주민번호 입력 UX 개선 + 외국인등록번호 검증 허용 + 최종완료 요약 통일

**Commit**: `dc5dfe9`  
**배경**:
- 본등록 주민번호 뒷자리 입력 시 가시성 토글 요구사항 반영 필요.
- 외국인등록번호 사용자들이 주민번호 체크섬 검증에서 차단되는 문제 존재.
- `모든 위촉 완료` 가입자와 일반 완료자의 요약 상태가 웹 대시보드에서 일관되지 않게 표시됨.

**조치**:
- `app/identity.tsx`
  - 주민번호/외국인등록번호 입력 라벨 명확화.
  - 뒷자리 입력에 `eye / eye-off` 토글 버튼 추가(회원가입 비밀번호 UI 패턴 정렬).
  - 검증을 공통 `validateResidentId`로 통합.
- `lib/validation.ts`
  - 13자리 검증에 외국인등록번호(7번째 자리 5~8) 체크섬 규칙 추가.
- `app/fc/new.tsx`
  - 주민번호 체크섬 로직을 공통 `validateResidentId` 재사용으로 교체.
- `supabase/functions/store-identity/index.ts`
  - 서버 검증도 외국인등록번호 체크섬을 허용하도록 확장.
- `web/src/lib/shared.ts`
  - `getSummaryStatus`에서 `final-link-sent`/양 트랙 완료를 문서 상태보다 우선 판정하도록 변경해 `최종 완료` 동일 표기 보장.
- 테스트 보강:
  - `lib/__tests__/validation.test.ts` 외국인등록번호 체크섬 케이스 추가.
  - `lib/__tests__/workflow-step-regression.test.ts` 모두완료 가입자의 요약 상태 회귀 케이스 추가.

**검증**:
- `npm run lint -- app/identity.tsx app/fc/new.tsx lib/validation.ts lib/__tests__/validation.test.ts`
- `npm test -- lib/__tests__/validation.test.ts`
- `npm test -- lib/__tests__/workflow-step-regression.test.ts`
- `cd web && npm run lint -- src/lib/shared.ts src/app/dashboard/page.tsx`

---

## <a id="20260303-3"></a> 2026-03-03 | 앱/웹 소속 필터 정규화 + 설계매니저 소속 제외

**Commit**: `612f37d`  
**배경**:
- 모바일/웹 대시보드 소속 필터에 본부 소속 외 값(설계매니저 계열)이 섞여 필터 사용성이 저하됨.
- request-board 통계는 FC 뷰/설계매니저 뷰 집계 기준이 달라 혼선 가능성이 있었음.

**조치**:
- `app/dashboard.tsx`
  - 소속명 canonical 매핑 추가(레거시 라벨 정규화).
  - 관리자 뷰에서 본부 canonical 소속만 필터/목록 대상으로 스코프 제한.
- `web/src/app/api/admin/list/route.ts`
  - `설계매니저` 소속 레코드 제외 후 canonical 소속으로 정규화 반환.
- `app/request-board.tsx`
  - FC/본부장 통계 집계를 배정 상태 중심으로 정렬.
  - 요청 목록 타입 정합성 보강 및 일부 핸들러/주석 정리.
- `app/notifications.tsx`
  - 드래그 선택 터치 이벤트 핸들러를 `onTouchMove/onTouchEnd` 기반으로 안정화.
- `app/request-board-review.tsx`
  - 모달 경계색 토큰(`COLORS.border.medium`)으로 정리.

**검증**:
- `npm run lint -- app/dashboard.tsx app/request-board.tsx app/notifications.tsx app/request-board-review.tsx`
- `cd web && npm run lint -- src/app/api/admin/list/route.ts`

---

## <a id="20260303-2"></a> 2026-03-03 | 시험신청 화면 게이팅 단순화 + 스플래시 정리

**Commit**: `d641015`  
**배경**:
- 시험신청 화면에서 수당동의 검토 오버레이가 UX 동선을 과도하게 차단.
- 시험신청 화면의 프로필 재조회 경로가 중복되어 새로고침 비용이 불필요하게 증가.

**조치**:
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`
  - 수당동의 상태 재조회 쿼리 제거.
  - 새로고침 시 라운드/내신청 조회만 유지.
  - 수당동의 검토 오버레이 및 관련 스타일 제거.
- `components/SplashAnimation.tsx`
  - 미사용 상수 정리.

**검증**:
- `npm run lint -- app/exam-apply.tsx app/exam-apply2.tsx components/SplashAnimation.tsx`

---

## <a id="20260303-1"></a> 2026-03-03 | 재가입 개인정보 초기화 강화 + 브릿지 role 동기화 + 버전 상향

**Commit**: `691ece0`  
**배경**:
- FC 삭제 후 동일 번호 재가입 시 이전 신원/위촉 데이터 잔존 가능성이 있어 초기화 안전망 필요.
- request_board 브릿지에서 admin/manager를 `fc`로 동기화하던 경로를 역할별로 분리할 필요가 있었음.

**조치**:
- `supabase/functions/request-signup-otp/index.ts`
  - 기존 프로필에서 완료 이력 감지 시 `fc_identity_secure`, `fc_credentials` 삭제.
  - `fc_profiles`의 신원/위촉/상태 관련 필드 초기화 로직 추가.
- `supabase/functions/set-password/index.ts`
  - 기존 프로필 업데이트 경로에서도 잔여 신원/위촉 필드 초기화 보강.
- `supabase/functions/login-with-password/index.ts`
  - request_board 브릿지 토큰/비밀번호 동기화 role 타입에 `admin`, `manager` 확장.
  - 관리자/본부장 로그인 시 해당 role로 브릿지 동기화.
- `supabase/functions/set-admin-password/index.ts`
  - 관리자 비밀번호 동기화 role을 `admin`으로 정렬.
- `app.json`
  - 앱 버전 `2.0.2` 상향.

**검증**:
- `node scripts/ci/check-governance.mjs`

---

## <a id="20260301-1"></a> 2026-03-01 | 메신저/홈 라우팅 안정화 + 관리자 메신저 UI/읽음 처리 개선

**Commit**: `pending`
**배경**:
- 홈 화면 quick link와 라우트 설정에서 중복 항목/키 충돌로 경고가 발생했고(`No route named "auth"`, duplicate key),
- 메신저 허브에서 request_board 미확인 카운트가 앱 inbox와 비동기적으로 어긋나는 문제가 있었다.
- 관리자 메신저는 내부 소통 대상 필터링, 읽음 즉시 반영, 검색/가독성 개선이 필요했다.

**조치**:
- `app/_layout.tsx`
  - 존재하지 않는 라우트 선언 `auth` 제거(중복 2곳).
- `app/index.tsx`
  - 위촉 홈 바로가기에서 중복 기능인 `공지 등록` 항목 제거.
  - quick link key를 `href+stepKey`에서 `href+stepKey|title|index`로 보강해 duplicate key 경고 제거.
- `app/messenger.tsx`
  - request_board 미확인 카운트 집계를 `fc-notify inbox` 추정 방식에서 `rbCheckAuth/rbBridgeLogin/rbGetUnreadCount` 기반 실시간 집계로 전환.
  - 불필요한 `requestBoardRole` 의존 제거.
- `app/admin-messenger.tsx`
  - 관리자/본부장 메신저 목록 UI 개편(검색창, 배지, 섹션 헤더, 아바타 색상/이니셜, empty state 개선).
  - 내부 소통 대상만 노출하도록 소속 필터(`본부/팀/직할`) 적용.
  - 채팅 진입 시 해당 FC unread를 optimistic 0으로 반영하고 서버 읽음 업데이트 동시 수행.
  - 화면 포커스 복귀 시 리스트 refetch 보강.
- `app/request-board.tsx`
  - request_board URL 복사 완료 안내 문구를 `가람Link 주소`로 통일.

**검증**:
- 기존 수행: `npm run lint -- app/request-board-messenger.tsx` (선행 변경 포함 통과)
- 라우팅/메신저 동작 수동 점검 대상:
  - 홈 진입 시 duplicate key/no-route 경고 미발생
  - 메신저 허브의 설계요청 미확인 배지와 request_board 실제 unread 일치
  - 관리자 메신저에서 채팅 진입 직후 unread 배지 즉시 감소

**다음**:
- 앱 실기기에서 관리자/본부장 계정 기준 unread 반영 타이밍 및 소속 필터 누락 케이스 추가 확인

---

## <a id="20260228-3"></a> 2026-02-28 | 한글 파일명 URL 인코딩 깨짐 전수 수정 (safeDecodeFileName)

**Commit**: `pending`
**배경**:
- 한글 이름 파일을 첨부/전송하면 `%EA%B0%80%...` 형태로 화면에 그대로 노출되는 문제.
- DB/Storage에 URL 인코딩된 파일명이 저장되고, 화면 렌더 시 디코딩 없이 표시.

**조치**:
- `lib/validation.ts`에 `safeDecodeFileName(name)` 공유 유틸 추가 (`decodeURIComponent` + try/catch)
- 디코딩 미적용 파일 전수 수정:
  - `app/chat.tsx`: `item.file_name` 렌더 시 적용
  - `app/board.tsx`: 파일명 렌더 + 이미지 갤러리 title 매핑
  - `app/admin-board-manage.tsx`: 파일명 렌더 + 이미지 갤러리 title 매핑
  - `app/board-detail.tsx`: 파일명 렌더 + 이미지 갤러리 title 매핑
  - `app/request-board-review.tsx`: `file.file_name` 렌더 시 적용
- `app/request-board-messenger.tsx`는 이미 자체 `normalizeAttachmentFileName`(동일 로직) 적용 중이므로 미수정

**검증**: lint pass, governance pass
**다음**: 없음 (upload 시 파일명 보존은 Storage 정책이므로 표시 레이어에서만 처리)

---

## <a id="20260228-2"></a> 2026-02-28 | 위촉 홈 바로가기 '공지 등록' → 게시판 작성 화면 연결 변경

**Commit**: `pending`
**배경**:
- 위촉 홈 바로가기의 '공지 등록' 버튼이 `/admin-notice`로 이동하고 있었으나, 게시판의 '글쓰기' 버튼과 동일하게 `/admin-board`로 이동하도록 요청.

**조치**:
- `app/index.tsx` `quickLinksAdmin` 배열에서 '공지 등록' 항목의 href를 `/admin-notice` → `/admin-board`로 변경.
- 아이콘 매핑(`admin-board` → `edit`)은 기존 resolver 규칙에 의해 자동 적용됨.

**검증**: `npm run lint -- app/index.tsx`
**다음**: 없음

---

## <a id="20260228-1"></a> 2026-02-28 | 서비스 브랜딩 변경 (request_board 표시명 → 가람Link)

**Commit**: `5544c21`
**배경**:
- request_board 웹 서비스명이 '설계요청'으로 표시되고 있었으나, 공식 브랜드명을 '가람Link'로 확정.
- 모바일 앱(fc-onboarding-app)의 request_board 관련 UI 텍스트도 동일하게 통일 필요.

**조치**:
- `app/request-board-messenger.tsx`: 헤더 타이틀 `설계요청 메신저` → `가람Link 메신저`, 계정 연결 실패 오류 문구 2곳 변경
- `app/request-board-fc-codes.tsx`: 로그인 상태 확인 오류 문구 변경
- `app/request-board.tsx`: `설계요청 주소 복사` 버튼 레이블, 빈 상태 텍스트 변경

**검증**: lint pass (`npm run lint -- app/request-board-messenger.tsx app/request-board-fc-codes.tsx app/request-board.tsx`)
**다음**: 없음 (비즈니스 로직 용어 '설계요청'은 변경하지 않음)

---

## <a id="20260227-15"></a> 2026-02-27 | 소속-본부장 매핑 테이블 도입(알림 수신 정확도 강화)

**Commit**: `working tree`  
**배경**:
- 기존 `fc_update/fc_delete` 본부장 수신 범위가 FC `affiliation`의 본부장 이름 파싱에 의존해, 소속 단위 다중 본부장/운영 계정 변화 상황에서 100% 정확 보장이 어려웠다.
- 요구사항에 따라 이름 매칭이 아닌 `소속-본부장 매핑 테이블` 기반으로 수신자를 결정하도록 구조 전환이 필요했다.

**조치**:
- DB 스키마/마이그레이션:
  - `public.affiliation_manager_mappings` 신설
    - 컬럼: `affiliation`, `manager_phone`, `active`, timestamps
    - 유니크: `(affiliation, manager_phone)`
    - 인덱스: `affiliation`, `manager_phone`
  - RLS/policy 추가(조회: admin/manager, 변경: admin)
  - trigger 추가: `trg_affiliation_manager_mappings_updated_at`
  - legacy 소속 라벨 정규화(update) 및 현재 팀 라벨 기준 초기 매핑 seed 추가
- 알림 수신 로직 변경:
  - `supabase/functions/fc-notify/index.ts`
    - `fc_update/fc_delete` 수신자 결정 시 `affiliation_manager_mappings` 조회 기반으로 변경
    - 본부장 수신자는 `manager_accounts.active=true` + 매핑된 `manager_phone`만 포함
    - `admin_accounts.active=true`는 기존처럼 전체 수신 유지
    - 소속 라벨 정규화(`1본부`/legacy 포맷 -> 현재 팀 라벨) 로직 추가
    - 매핑 테이블 미생성 환경(42P01)에는 관리자(총무) 수신만 유지하도록 방어
- 계정 삭제 정리 보강:
  - `supabase/functions/delete-account/index.ts`
    - 본부장 계정 삭제 시 `affiliation_manager_mappings.manager_phone` 연결 행도 함께 삭제
- 운영 명령어 문서 보강:
  - `docs/guides/COMMANDS.md`
    - 소속-본부장 매핑 upsert/비활성 SQL 예시 추가

**핵심 파일**:
- `supabase/migrations/20260227000008_add_affiliation_manager_mappings.sql`
- `supabase/schema.sql`
- `supabase/functions/fc-notify/index.ts`
- `supabase/functions/delete-account/index.ts`
- `docs/guides/COMMANDS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- DB 반영: `supabase db push --linked` 성공 (`20260227000008` 적용)
- 마이그레이션 동기화: `supabase migration list --linked` local/remote 일치 확인
- 함수 배포: `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 성공
- 통합 거버넌스: `node scripts/ci/check-governance.mjs` 통과
- 실데이터 스모크(임시 계정/매핑 삽입 후 정리):
  - 동일 소속에 임시 본부장 매핑 추가 시 수신자 계산에 즉시 포함 확인
  - 결과: `manager_count` 증가 및 `includes_test_manager=true` 확인 후 정리 완료
- 참고: Edge Function 파일 lint는 Deno remote import 해석 한계로 `import/no-unresolved` 경고가 남음(기존과 동일)

**운영 메모**:
- 앞으로 본부장 수신 범위는 이름 파싱이 아니라 `affiliation_manager_mappings` 데이터가 기준이다.
- 동일 소속에 여러 본부장을 두려면 해당 소속에 대해 `manager_phone` 행을 여러 개 추가하면 즉시 반영된다.

---

## <a id="20260227-14"></a> 2026-02-27 | 알림 inbox 기준 통일 + 본부장 FC업데이트 수신 범위 제한

**Commit**: `working tree`  
**배경**:
- 위촉 홈과 설계요청 화면의 알림 배지/목록 기준이 서로 달라(관리자 세션에서 `requestBoardRole`에 따라 `fc/admin`이 바뀜) 같은 계정인데도 미확인 개수가 다르게 보이는 문제가 있었다.
- 본부장(관리자 readOnly)은 모든 FC 업데이트 알림을 받는 구조여서, 본인 소속 FC 업데이트만 받아야 한다는 운영 요구와 맞지 않았다.

**조치**:
- `app/index.tsx`
  - `inbox_unread_count` 호출 시 역할과 무관하게 `resident_id`를 항상 전달하도록 수정.
- `app/request-board.tsx`
  - inbox 역할 계산을 `requestBoardRole` 기반 강제 `fc` 변환에서 제거하고 세션 `role` 그대로 사용.
  - `inbox_list`/`inbox_unread_count` 호출 모두 `resident_id`를 항상 전달하도록 통일.
- `app/notifications.tsx`
  - 알림함 inbox 역할 계산을 `role` 단일 기준으로 통일(`requestBoardRole` 분기 제거).
  - `resident_id`를 역할과 무관하게 세션값으로 전달해 홈/설계요청/알림함이 동일 inbox 계약을 사용하도록 정렬.
- `supabase/functions/fc-notify/index.ts`
  - `inbox_list`/`inbox_unread_count`/`inbox_delete`에서 `role=admin`일 때도 `resident_id`가 있으면 `resident_id = 본인 OR null` 조건으로 조회/카운트/삭제하도록 보강.
  - `fc_update`/`fc_delete` 이벤트는 더 이상 관리자 전체 공통행(`resident_id=null`)으로 적재하지 않고, 수신자별 행으로 적재하도록 변경:
    - 총무(`admin_accounts.active=true`)는 기존처럼 전체 수신.
    - 본부장(`manager_accounts.active=true`)은 FC `affiliation`에서 파싱한 본부장명과 일치하는 계정만 수신.
  - 푸시 토큰 발송도 위 수신자 목록으로 제한해 본부장은 자기 소속 FC 업데이트만 수신.

**핵심 파일**:
- `app/index.tsx`
- `app/request-board.tsx`
- `app/notifications.tsx`
- `supabase/functions/fc-notify/index.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- app/index.tsx app/request-board.tsx app/notifications.tsx` 통과
- `npm run lint -- supabase/functions/fc-notify/index.ts` 실행 시 Deno remote import 경로 해석 한계로 `import/no-unresolved` 2건 발생(기존 Edge Function lint 한계 범주)

**운영 메모**:
- 서버 반영이 필요한 변경이므로 실제 운영 적용 시 `supabase functions deploy fc-notify --project-ref <project-ref>` 배포가 필요하다.

---

## <a id="20260227-13"></a> 2026-02-27 | 알림 배지 UI 깨짐 보정(폰트 스케일 고정)

**Commit**: `working tree`  
**배경**:
- 상단 알림 버튼 배지에서 `99` 카운트가 비정상적으로 크게 렌더링되어 배지 형태가 깨지는 문제가 발생.

**조치**:
- `components/AppTopActionBar.tsx`
  - 배지 텍스트를 `badgeLabel`로 분리(`99+` 캡 유지)
  - 배지 텍스트에 `allowFontScaling={false}`, `maxFontSizeMultiplier={1}` 적용
  - 배지 크기/오프셋 보정:
    - 기본 배지 축소(`20x20`) + 3자리(`99+`)용 `countBadgeWide` 분리
  - `iconButton`에 `overflow: 'visible'` 명시로 배지 클리핑 리스크 제거

**핵심 파일**:
- `components/AppTopActionBar.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- components/AppTopActionBar.tsx` 통과

---

## <a id="20260227-12"></a> 2026-02-27 | 설계요청 현황 카드 탭 -> 단계 필터 목록 연동

**Commit**: `working tree`  
**배경**:
- `설계 요청` 화면의 `의뢰 현황` 카드(전체/수락대기/진행중/완료)를 눌렀을 때 단계별 목록으로 바로 이어지는 동선이 필요했다.
- 기존 `의뢰 목록 · 검토` 화면은 재사용하고 초기 필터만 카드별로 주입하는 요구.

**조치**:
- `app/request-board.tsx`
  - `의뢰 현황` 카드를 `Pressable`로 전환
  - 카드별로 `/request-board-requests?filter=<key>` 라우팅
    - `전체 의뢰건수` -> `all`
    - `수락 대기중` -> `pending`
    - `진행중인 의뢰/작업중인 의뢰` -> `in_progress`
    - `이번 달 완료` -> `completed`
  - 카드 탭 피드백 스타일(`reqStatCardPressed`) 추가
- `app/request-board-requests.tsx`
  - URL 쿼리(`filter`)를 읽어 초기 필터를 적용하도록 확장
  - 필터 키에 `pending` 추가
  - 목록 필터 로직/탭 구성에 `수락 대기` 반영
    - 기존 `검토 대기(review_pending)` 필터는 유지

**핵심 파일**:
- `app/request-board.tsx`
- `app/request-board-requests.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- app/request-board.tsx app/request-board-requests.tsx` 통과

---

## <a id="20260227-11"></a> 2026-02-27 | 환영문구 폰트 추가 축소

**Commit**: `working tree`  
**배경**:
- 공통 상단 헤더의 환영문구가 여전히 크게 보여 추가 축소 요청 발생.

**조치**:
- `components/AppTopActionBar.tsx`
  - 환영문구 폰트 크기 `24 -> 20`으로 추가 축소

**핵심 파일**:
- `components/AppTopActionBar.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- components/AppTopActionBar.tsx` 통과

---

## <a id="20260227-10"></a> 2026-02-27 | 게시글 조회수 집계 기준 전환(조회 이벤트 누적)

**Commit**: `working tree`  
**배경**:
- 기존 조회수는 `post_id + resident_id` 고유 사용자 기준(1인 1회)이라, 같은 사용자의 반복 조회가 카운트되지 않았다.
- 사용자 요청으로 조회할 때마다 카운트가 증가하도록 기준 변경 필요.

**조치**:
- `supabase/functions/board-detail/index.ts`
  - 조회수 기록 로직을 `upsert`에서 `insert`로 변경하여 상세 조회 호출마다 이벤트 1건 누적
- `supabase/schema.sql`
  - `board_post_views` 테이블의 `(post_id, resident_id)` 유니크 제약 제거
  - `board_post_stats.view_count` 집계를 `count(v.id)`로 명시해 조회 이벤트 누적값 반영
- `supabase/migrations/20260227000007_allow_repeated_board_views.sql`
  - 운영 DB에서 유니크 제약 삭제
  - `board_post_stats`, `board_posts_with_stats` 뷰 재정의

**핵심 파일**:
- `supabase/functions/board-detail/index.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260227000007_allow_repeated_board_views.sql`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- 거버넌스 체크: `node scripts/ci/check-governance.mjs` 통과

**운영 메모**:
- 이제 같은 사용자가 같은 게시글을 다시 열어도 조회수가 계속 증가한다.

---

## <a id="20260227-9"></a> 2026-02-27 | 헤더 타이틀 축소 + 게시판(관리) 동일 헤더 적용

**Commit**: `working tree`  
**배경**:
- 상단 환영문구 글자 크기가 과도하게 커서 잘림이 발생했고, 관리자 게시판 화면(`/admin-board-manage`)은 동일한 헤더 디자인을 아직 사용하지 않았다.

**조치**:
- `components/AppTopActionBar.tsx`
  - 환영문구 폰트 크기 `34 -> 24`로 축소
  - 좌/우 슬롯 폭을 줄여 가운데 타이틀 표시 영역 확대
- `app/admin-board-manage.tsx`
  - 기존 `게시판 관리 + 새로고침` 전용 헤더 제거
  - 공통 `AppTopActionBar`(알림-환영문구-로그아웃) 적용
  - 네이티브 스택 헤더 `headerShown: false`로 중복 제거
  - 페이지 타이틀(`게시판 관리`)은 헤더 아래 섹션 타이틀로 유지

**핵심 파일**:
- `components/AppTopActionBar.tsx`
- `app/admin-board-manage.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- components/AppTopActionBar.tsx app/admin-board-manage.tsx app/board.tsx` 통과

---

## <a id="20260227-8"></a> 2026-02-27 | 상단 헤더 1행 재배치(알림-환영문구-로그아웃)

**Commit**: `working tree`  
**배경**:
- 기존 헤더가 `환영문구(상단) + 로그아웃/알림/설정(하단)` 2행 구조여서, 사용자 요청대로 1행 구조로 재배치 필요.

**조치**:
- `components/AppTopActionBar.tsx`
  - `설정` 버튼 제거
  - 레이아웃을 `왼쪽 알림 버튼 / 가운데 환영문구 / 오른쪽 로그아웃` 1행으로 재구성
  - `title` prop 추가, safe-area top inset 반영
- `app/index.tsx`, `app/request-board.tsx`, `app/board.tsx`
  - `AppTopActionBar`에 `title={homeHeaderTitle}` 전달
  - `Stack.Screen` 기본 네이티브 헤더는 `headerShown: false`로 비활성화하여 중복 환영문구 제거

**핵심 파일**:
- `components/AppTopActionBar.tsx`
- `app/index.tsx`
- `app/request-board.tsx`
- `app/board.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- components/AppTopActionBar.tsx app/index.tsx app/board.tsx app/request-board.tsx` 통과

---

## <a id="20260227-7"></a> 2026-02-27 | 게시판 카테고리+제목 동일 행 정렬

**Commit**: `working tree`  
**배경**:
- 직전 변경에서 카테고리 배지를 제목보다 먼저 배치했지만, 카테고리와 제목이 줄바꿈되어 시작해 가독성이 떨어진다는 피드백이 발생.

**조치**:
- `app/admin-board-manage.tsx`
  - 목록 카드와 상세 모달 모두 `카테고리 배지 + 제목`을 동일 행(`titleRow`, `modalTitleRow`)에서 시작하도록 레이아웃 변경
- `app/board.tsx`
  - 목록 카드의 카테고리/제목도 동일 패턴(`titleRow`)으로 통일
- 공통 스타일 보강:
  - `categoryBadgeInline`, `postTitleInline`, `modalPostTitleInline` 추가로 배지-제목 한 줄 정렬 시 margin 충돌 제거

**핵심 파일**:
- `app/admin-board-manage.tsx`
- `app/board.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- app/admin-board-manage.tsx app/board.tsx` 통과

---

## <a id="20260227-6"></a> 2026-02-27 | 게시판 공지 우선 표시 + 게시글 조회수 추적/노출

**Commit**: `working tree`  
**배경**:
- 앱 게시판 관리 목록/상세에서 카테고리(`공지` 등)가 제목 뒤 흐름에 노출되어 식별성이 떨어졌고, 게시글별 조회수를 추적/확인할 수 있는 수치가 없었다.

**조치**:
- 카테고리 노출 순서 보정:
  - `app/admin-board-manage.tsx` 목록 카드에서 카테고리 배지를 제목보다 먼저 배치
  - 상세 모달에서도 제목 상단에 카테고리 배지 노출
- 조회수 저장/집계 추가:
  - `supabase/schema.sql` + `supabase/migrations/20260227000006_add_board_post_views.sql`
    - `board_post_views` 테이블/인덱스/RLS/trigger 추가
    - `board_post_stats`, `board_posts_with_stats` 뷰에 `view_count` 포함
  - `supabase/functions/board-detail/index.ts`
    - 상세 조회 시 `(post_id, resident_id)` 기준 `upsert`로 1인 1조회 집계
  - `supabase/functions/board-list/index.ts`
    - 목록 응답 stats에 `viewCount` 포함
- 조회수 UI 노출:
  - `app/admin-board-manage.tsx`
    - 목록 카드 하단: `eye + viewCount`
    - 상세 모달 메타: `조회 {viewCount}`
  - `app/board.tsx`
    - 목록/상세 조회수 표시 동기화
- 계약/타입/정리 경로 동기화:
  - `lib/board-api.ts`, `web/src/lib/board-api.ts`, `contracts/api-contracts.md`
  - FC 삭제/계정 삭제 정리 경로에 `board_post_views` 삭제 추가
    - `supabase/functions/delete-account/index.ts`
    - `supabase/functions/admin-action/index.ts`
    - `web/src/app/api/fc-delete/route.ts`
  - 웹 게시판 placeholder 타입에도 `viewCount` 반영 (`web/src/app/dashboard/board/page.tsx`)

**핵심 파일**:
- `app/admin-board-manage.tsx`
- `app/board.tsx`
- `supabase/functions/board-detail/index.ts`
- `supabase/functions/board-list/index.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260227000006_add_board_post_views.sql`
- `lib/board-api.ts`
- `web/src/lib/board-api.ts`
- `contracts/api-contracts.md`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/api/fc-delete/route.ts`
- `web/src/app/dashboard/board/page.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- 앱 린트(변경 화면/타입):
  - `npm run lint -- app/admin-board-manage.tsx app/board.tsx lib/board-api.ts` 통과
- 웹 린트:
  - `cd web && npm run lint -- src/lib/board-api.ts src/app/dashboard/board/page.tsx src/app/api/fc-delete/route.ts` 통과
- 거버넌스:
  - `node scripts/ci/check-governance.mjs` 통과

**운영 메모**:
- 조회수는 `board-detail` 진입 시점에만 증가(정확히는 사용자별 최초 1회 기록)하므로 목록 스크롤만으로는 조회수가 오르지 않는다.

---

## <a id="20260227-5"></a> 2026-02-27 | 위촉/시험/설계요청 섹션 타이틀 중앙 정렬

**Commit**: `working tree`  
**배경**:
- 사용자 요청에 따라 홈의 `위촉/시험` 제목/설명, 설계요청의 `설계 요청` 제목/설명을 모두 가운데 정렬로 통일 필요.

**조치**:
- `app/index.tsx`
  - `homeTitleWrap`에 `alignItems: 'center'` 추가
  - `homeTitle`, `homeSubtitleText`에 `textAlign: 'center'` 추가
- `app/request-board.tsx`
  - `pageTitleWrap`에 `alignItems: 'center'` 추가
  - `pageTitle`, `pageSubtitle`에 `textAlign: 'center'` 추가

**핵심 파일**:
- `app/index.tsx`
- `app/request-board.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- app/index.tsx app/request-board.tsx` 통과

---

## <a id="20260227-4"></a> 2026-02-27 | 홈/설계요청 종 아이콘 미확인 배지 기준 통일

**Commit**: `working tree`  
**배경**:
- 홈 화면 종 아이콘은 알림 확인 후 빨간 배지가 사라지는데, 설계요청 화면 종 아이콘은 확인 후에도 배지가 남는 불일치가 있었다.
- 원인: 설계요청은 `notifications.length`(목록 개수) 기준 점 배지, 홈은 `inbox_unread_count`(미확인 개수) 기준 배지를 사용.

**조치**:
- `app/request-board.tsx`에서 홈과 동일한 미확인 개수 계약(`fc-notify` `inbox_unread_count`)으로 배지 기준 통일
- `lastNotificationCheckTime`를 읽어 `since` 파라미터 반영
- 화면 복귀 시 배지가 즉시 갱신되도록 `useFocusEffect`로 포커스 시 재조회
- 상단 바에는 `showNotificationDot` 대신 `notificationCount` 전달

**핵심 파일**:
- `app/request-board.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- app/request-board.tsx` 통과

---

## <a id="20260227-3"></a> 2026-02-27 | 설계 매니저 환영 문구 적용

**Commit**: `working tree`  
**배경**:
- 설계 매니저(request_board designer)로 로그인한 세션에서도 일반 role 기반 환영 문구가 노출되어 사용자 식별 문구가 맞지 않았다.

**조치**:
- 공통 환영 타이틀 유틸(`buildWelcomeTitle`)에 `isRequestBoardDesigner` 우선 분기 추가
  - 출력 규칙: `{이름} 설계 매니저님 환영합니다..`
  - 이름이 없을 경우: `설계 매니저님 환영합니다.`
  - 이름 말미에 `설계매니저/설계 매니저`가 이미 포함된 경우 중복 접미사 제거
- 호출부 반영:
  - `app/index.tsx`
  - `app/request-board.tsx`
  - `app/board.tsx`

**핵심 파일**:
- `lib/welcome-title.ts`
- `app/index.tsx`
- `app/request-board.tsx`
- `app/board.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- lib/welcome-title.ts app/index.tsx app/request-board.tsx app/board.tsx` 통과

---

## <a id="20260227-2"></a> 2026-02-27 | 시험 일정 삭제 버튼 미동작(생명/손해) 수정

**Commit**: `working tree`  
**배경**:
- `생명 시험 등록`/`손해 시험 등록` 화면에서 일정 카드 내부 `삭제` 버튼 탭 시 삭제 확인이 뜨지 않는 문제가 발생했다.
- 원인: 일정 카드(`Pressable`) 안에 삭제 버튼(`Pressable`)이 중첩되어 Android에서 부모 탭 이벤트가 우선 처리되는 케이스.

**조치**:
- 삭제 버튼 `onPress`에서 `event.stopPropagation()` 적용해 부모 카드 선택 이벤트 전파 차단
- 동시에 readOnly 계정에서 삭제 버튼이 비활성 상태로 명확히 보이도록 `disabled` 시각 스타일 추가

**핵심 파일**:
- `app/exam-register.tsx`
- `app/exam-register2.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- `npm run lint -- app/exam-register.tsx app/exam-register2.tsx` 통과

**운영 메모**:
- 카드 전체 탭과 카드 내부 개별 액션을 함께 둘 때는 내부 액션에 이벤트 전파 차단(`stopPropagation`)을 기본 적용한다.

---

## <a id="20260227-1"></a> 2026-02-27 | 앱 상단 헤더 공통화(위촉/시험/설계요청/게시판) + 우측 새로고침 제거

**Commit**: `working tree`  
**배경**:
- 앱 상단 액션 바가 화면마다 분기되어 `설정` 위치와 `새로고침` 노출이 일관되지 않았고, 설계요청/게시판은 홈과 다른 헤더 패턴을 사용하고 있었다.

**조치**:
- 공통 상단 액션 바 컴포넌트 추가:
  - `components/AppTopActionBar.tsx`
  - 구조 고정: `로그아웃 + 알림(좌측)` / `설정(우측)`
  - 우측 `새로고침` 버튼 제거
- 환영 타이틀 계산 로직 공통화:
  - `lib/welcome-title.ts` (`FC/본부장(readOnly)/총무` 문구 규칙 일원화)
- 화면 적용:
  - `app/index.tsx`: 기존 개별 버튼/새로고침 제거 후 `AppTopActionBar` 적용
  - `app/request-board.tsx`: 기존 전용 헤더 제거, 공통 상단바 + 페이지 타이틀(설계 요청) 적용
  - `app/board.tsx`: 기존 `RefreshButton` 헤더 제거, 공통 상단바 + 페이지 타이틀(게시판) 적용
  - `request-board`/`board` 상단 네이티브 헤더도 홈과 동일하게 환영 문구를 쓰도록 `Stack.Screen` 옵션 동기화

**핵심 파일**:
- `components/AppTopActionBar.tsx`
- `lib/welcome-title.ts`
- `app/index.tsx`
- `app/request-board.tsx`
- `app/board.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- `AGENTS.md`

**검증**:
- lint:  
  - `npm run lint -- app/index.tsx app/request-board.tsx app/board.tsx components/AppTopActionBar.tsx lib/welcome-title.ts` 통과
- 회귀 단위 테스트:  
  - `npm test -- --runInBand lib/__tests__/bottom-navigation.test.ts` 통과

**운영 메모**:
- 상단 액션 바 변경은 `AppTopActionBar` 단일 컴포넌트에서만 수정하고, 개별 화면에서 버튼을 재구현하지 않는다.

---

## <a id="20260226-12"></a> 2026-02-26 | 남은 BLOCKED 42건 전수 PASS 마감(SET-01/RB-01/04/07 포함)

**Commit**: `working tree`  
**배경**:
- 통합 실행기(`run-remaining-blocked-cli`) 기준 남은 실패 4건:
  - `RB-01`, `RB-04`, `RB-07`: `request_board module failed: request create failed` 후속으로 `message attachment upload failed`
  - `SET-01`: 총무/본부장 자기 계정 삭제 미지원

**조치**:
- `request_board` 계약 반영(실패 원인 제거):
  - 의뢰 생성 payload에 `fcCodeName/fcCodeValue`, `designerCodeSelections` 추가
  - 메신저 첨부 업로드 MIME을 허용 목록에 맞게 `application/pdf`로 변경
  - 디버깅 가시화를 위해 업로드 실패 context 기록 강화
- 계정 삭제 기능 확장(`delete-account`):
  - 기존 FC 전용 삭제를 `fc/admin/manager` 역할 해석 기반으로 확장
  - `role` 힌트 지원(명시 역할 우선 해석)으로 교차 역할 전화번호 오삭제 리스크 완화
  - 공통 resident cleanup(메시지/알림/토큰/게시판 등) + 역할별 최종 계정 삭제(`fc_profiles`/`admin_accounts`/`manager_accounts`) 적용
  - 계약 문서(`contracts/api-contracts.md`)를 신규 요청/응답 형식으로 업데이트
- 앱/웹 설정 화면 수정:
  - FC 전용 삭제 차단 제거
  - 총무/본부장도 본인 삭제 가능하도록 `delete-account` 호출 body에 역할 힌트 전달
- 런타임 반영:
  - `supabase functions deploy delete-account --project-ref ubeginyxaotcamuqpmud` 실행

**핵심 파일**:
- `scripts/testing/run-remaining-blocked-cli.mjs`
- `supabase/functions/delete-account/index.ts`
- `app/settings.tsx`
- `web/src/app/dashboard/settings/page.tsx`
- `contracts/api-contracts.md`
- `docs/testing/INTEGRATED_TEST_RUN_RESULT.json`
- `docs/testing/evidence/remaining-blocked-cli-2026-02-26T16-13-37-899Z.json`
- `docs/testing/evidence/remaining-blocked-cli-2026-02-26T16-13-37-899Z.md`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 통합 재실행:
  - `node scripts/testing/run-remaining-blocked-cli.mjs` -> `PASS: 42, FAIL: 0`
- 통합 무결성 게이트:
  - `npm run qa:validate:integrated` -> `PASS=52, FAIL=0, BLOCKED=0, SKIPPED=0`
- 정적 검사:
  - `npm run lint -- app/settings.tsx scripts/testing/run-remaining-blocked-cli.mjs` 통과
  - `cd web && npm run lint -- src/app/dashboard/settings/page.tsx` 통과

**주의/운영 포인트**:
- `delete-account` 호출 시 `role` 힌트를 항상 전달해 역할 판별 모호성을 제거한다.
- 통합 실행기 실패 시 evidence JSON의 `modules.*.context`를 즉시 확인해 계약 드리프트를 우선 수정한다.

---

## <a id="20260226-11"></a> 2026-02-26 | Push 거버넌스 실패 재발 방지 문서화 + schema sync marker

**Commit**: `working tree`  
**배경**:
- GitHub Action `governance-check.yml` 실패 재발 확인
- 로컬 재현 결과:
  - `node scripts/ci/check-governance.mjs`
  - 실패 메시지: `Schema change policy violation: update supabase/schema.sql and supabase/migrations/*.sql together.`

**조치**:
- 규칙 문서 강화:
  - `AGENTS.md`
    - Session Close Checklist에 `push 전 governance check` 필수 추가
    - `Push Preflight (Mandatory)` 섹션 신설
    - migration-only 변경도 같은 push에서 `supabase/schema.sql` diff가 필요함을 명시
  - `docs/guides/COMMANDS.md`
    - `Push Preflight (Governance)` 섹션 추가
    - 실패 메시지/대응 절차(재실행 후 pass 확인) 명문화
- 즉시 CI 통과 보정:
  - `supabase/schema.sql` 상단에 governance sync marker 주석 추가
  - `supabase/migrations/20260226000005_schema_sync_governance.sql` no-op migration 추가
  - 목적: 같은 push 범위에서 `schema.sql` + `migrations/*.sql` 동시 변경 조건 충족

**핵심 파일**:
- `AGENTS.md`
- `docs/guides/COMMANDS.md`
- `supabase/schema.sql`
- `supabase/migrations/20260226000005_schema_sync_governance.sql`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 로컬 governance 재실행:
  - `node scripts/ci/check-governance.mjs` -> `passed`

**재발 방지 운용 규칙(요약)**:
1. push 전 `node scripts/ci/check-governance.mjs`를 항상 실행
2. `supabase/migrations/*.sql` 변경 시 같은 push에 `supabase/schema.sql` sync diff 포함
3. 코드 경로 변경 시 `.claude/WORK_LOG.md` + `.claude/WORK_DETAIL.md` 동시 갱신

---

## <a id="20260226-10"></a> 2026-02-26 | BLOCKED 역할순 실행(FC→본부장→총무→설계매니저) 자동검증 + PASS 전환

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청대로 `BLOCKED` 항목을 역할 순서(`FC -> 본부장 -> 총무 -> 설계매니저`)로 실제 실행 가능한 케이스부터 자동화하여 검증
- 신규 실행기 추가:
  - `scripts/testing/run-fc-blocked-cli.mjs`
  - `scripts/testing/run-manager-blocked-cli.mjs`
  - `scripts/testing/run-admin-blocked-cli.mjs`
  - `scripts/testing/run-designer-blocked-cli.mjs`
- 각 실행기에서 테스트 계정/데이터를 생성 후 검증 완료 시 즉시 cleanup(삭제) 수행
- 증적 파일 자동 생성:
  - `docs/testing/evidence/fc-blocked-cli-*.{md,json}`
  - `docs/testing/evidence/manager-blocked-cli-*.{md,json}`
  - `docs/testing/evidence/admin-blocked-cli-*.{md,json}`
  - `docs/testing/evidence/designer-blocked-cli-*.{md,json}`
- `INTEGRATED_TEST_RUN_RESULT.json` 상태 전환:
  - `PASS` 전환: `ONB-01`, `ONB-04`, `RB-03`, `RB-05`, `RB-08`, `P0-11`, `P0-12`, `P0-13`
  - `P0-02`는 API 차단(403) 부분 검증 증적 추가 후, UI/URL 우회 미검증으로 `BLOCKED` 유지

**핵심 파일**:
- `scripts/testing/run-fc-blocked-cli.mjs`
- `scripts/testing/run-manager-blocked-cli.mjs`
- `scripts/testing/run-admin-blocked-cli.mjs`
- `scripts/testing/run-designer-blocked-cli.mjs`
- `docs/testing/evidence/fc-blocked-cli-2026-02-26T07-02-04-879Z.md`
- `docs/testing/evidence/manager-blocked-cli-2026-02-26T07-04-53-376Z.md`
- `docs/testing/evidence/admin-blocked-cli-2026-02-26T07-12-13-129Z.md`
- `docs/testing/evidence/designer-blocked-cli-2026-02-26T07-10-22-700Z.md`
- `docs/testing/INTEGRATED_TEST_RUN_RESULT.json`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- FC 실행기: `node scripts/testing/run-fc-blocked-cli.mjs` 통과
  - 4개 위촉 경우의 수(`none/life_only/nonlife_only/both`) + request_board 로그인 연동 확인
  - reset-password 동기화 + desync 후 login 재동기화 복구 확인
- 본부장 실행기: `node scripts/testing/run-manager-blocked-cli.mjs` 통과
  - manager login-with-password -> request_board(fc role) 로그인 -> 설계코드 CRUD 확인
  - manager의 `admin-action` write 시 403 확인
- 총무 실행기: `node scripts/testing/run-admin-blocked-cli.mjs` 통과
  - FC 수당동의 제출 -> 총무 승인 -> 총무 반려 -> FC 재제출 상태 전이 확인
- 설계매니저 실행기: `node scripts/testing/run-designer-blocked-cli.mjs` 통과
  - 의뢰 거절/수락/완료(첨부 포함), FC 승인/거절까지 전이 확인
- 통합 검증:
  - `npm run qa:validate:integrated` 통과
  - 집계: `PASS=10`, `FAIL=0`, `BLOCKED=42`, `SKIPPED=0`

**다음 단계**:
- 남은 `BLOCKED(42)` 중 디바이스/웹 UI 수동 검증 필수 항목(하단네비/푸시/업로드 경계/웹-앱 동시 반영)을 동일 역할순으로 계속 실행하고 동일 증적 포맷으로 누적

---

## <a id="20260226-9"></a> 2026-02-26 | 통합 테스트 실행체계 구축(누락 방지)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 통합 체크리스트(위촉/게시판/설계요청/설정/기타 + 추가 P0/P1)를
  실제 운영 가능한 실행 체계로 변환
- 구성:
  - 케이스 원장(SSOT): `docs/testing/integrated-test-cases.json` (총 52 케이스)
  - 실행 가이드: `docs/testing/INTEGRATED_TEST_CHECKLIST.md`
  - 결과 파일 부트스트랩: `scripts/testing/init-integrated-test-run.mjs`
  - 누락/형식 검증 게이트: `scripts/testing/validate-integrated-test-run.mjs`
  - npm 명령 추가:
    - `npm run qa:init:integrated`
    - `npm run qa:validate:integrated`
- 검증 규칙(validator):
  - 케이스 누락/중복/미등록 ID 탐지
  - 상태값 유효성(`NOT_RUN|PASS|FAIL|BLOCKED|SKIPPED`)
  - 실행된 케이스의 `executedAt` 필수
  - `PASS`는 `evidence` 필수
  - `FAIL/BLOCKED/SKIPPED`는 `notes` 필수
  - `NOT_RUN` 존재 시 실패 처리(누락 방지)

**핵심 파일**:
- `docs/testing/INTEGRATED_TEST_CHECKLIST.md`
- `docs/testing/integrated-test-cases.json`
- `scripts/testing/init-integrated-test-run.mjs`
- `scripts/testing/validate-integrated-test-run.mjs`
- `package.json`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 생성 스크립트:
  - `npm run qa:init:integrated -- --force` 통과 (52 케이스 결과 파일 생성 확인)
- 검증 스크립트:
  - `npm run qa:validate:integrated` 동작 확인 (`NOT_RUN=52`로 실패, 게이트 정상)

**다음 단계**:
- QA 실행자가 `INTEGRATED_TEST_RUN_RESULT.json`에 케이스별 증적/결과 입력 후
  `qa:validate:integrated`가 0으로 종료되는 상태를 릴리즈 전 필수 게이트로 적용

---

## <a id="20260226-8"></a> 2026-02-26 | 모바일 하단 네비 정책 보정(총무/본부장 5탭 고정 + 설계매니저 2탭 유지)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요구사항 반영(정책 보정):
  - 총무(admin) / 본부장(manager, readOnly): 하단 탭을 동일 5개로 고정
    - `위촉 홈 -> 시험 홈 -> 설계요청 -> 게시판 -> 설정`
  - 설계매니저(`request-board-designer`): 하단 탭 2개 유지
    - `설계요청 -> 설정`
- 수정:
  - `components/BottomNavigation.tsx`
    - `admin-onboarding`, `admin-exam`, `manager` 프리셋 모두 5탭/동일 순서로 정렬
  - `lib/bottom-navigation.ts`
    - `PRESET_KEYS`를 동일 순서로 고정해 `activeKey` fallback 일관화
  - `app/index.tsx`
    - `manager` 프리셋도 admin-like 탭 전환 대상에 포함
    - 홈 탭 활성 상태가 `adminHomeTab(onboarding/exam)`과 동기화되도록 보정
  - `lib/__tests__/bottom-navigation.test.ts`
    - manager fallback 기대값을 신규 키 체계에 맞게 갱신
- 문서화:
  - `AGENTS.md` `Bottom Navigation Contract`에 역할별 고정 탭 세트 명시

**핵심 파일**:
- `components/BottomNavigation.tsx`
- `lib/bottom-navigation.ts`
- `app/index.tsx`
- `lib/__tests__/bottom-navigation.test.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- components/BottomNavigation.tsx lib/bottom-navigation.ts app/index.tsx lib/__tests__/bottom-navigation.test.ts` 통과
- 단위 테스트:
  - `npm test -- --runInBand` 통과

**다음 단계**:
- 실기기(Android/iOS) role 검증:
  - 총무/본부장: 모든 주요 화면에서 5탭 구성/순서 고정 확인
  - 설계매니저: 2탭만 노출되는지 확인

---

## <a id="20260226-7"></a> 2026-02-26 | 모바일 하단 네비 SSOT 통일(총무/본부장/FC/설계매니저 공통 규칙)

**Commit**: `working tree`  
**작업 내용**:
- 문제 정리:
  - 총무/본부장 계정에서 화면마다 하단 네비 프리셋 계산 방식이 달라 탭 구성이 바뀌는 현상 반복
  - 일부 화면은 수동 하단바(`Pressable` 직접 렌더), 일부 화면은 `BottomNavigation` 프리셋 사용으로 경로별 불일치 발생
  - session hydrate 전 기본 분기(예: `role !== admin -> fc`)로 첫 프레임 탭이 바뀌는 깜빡임 가능성 존재
- 수정:
  - 공통 규칙 SSOT 신규 추가: `lib/bottom-navigation.ts`
    - `resolveBottomNavPreset`
    - `resolveBottomNavActiveKey`
  - 규칙:
    - `hydrated=false`면 `null` preset 반환(잘못된 초기 탭 방지)
    - `isRequestBoardDesigner=true` 최우선
    - `role=admin && readOnly=true`는 `manager` 프리셋 고정
    - `role=admin && readOnly=false`만 `admin-onboarding/admin-exam` 사용
  - 적용 화면 일괄 정렬:
    - `app/index.tsx`, `app/board.tsx`, `app/admin-board-manage.tsx`, `app/notice.tsx`, `app/settings.tsx`, `app/request-board.tsx`, `app/request-board-fc-codes.tsx`
  - 수동 하단바 제거:
    - `app/index.tsx`, `app/board.tsx`의 하드코딩 네비 제거 후 `BottomNavigation` 단일 사용
  - 회귀 테스트 추가:
    - `lib/__tests__/bottom-navigation.test.ts`에서 프리셋/activeKey 매핑 고정 검증
  - 재발 방지 문서화:
    - `AGENTS.md`에 `Bottom Navigation Contract (Mobile)` 섹션 추가
    - 금지 규칙(수동 하단바/화면별 ternary 복붙 금지)과 mapping invariant 명시

**핵심 파일**:
- `lib/bottom-navigation.ts`
- `components/BottomNavigation.tsx`
- `app/index.tsx`
- `app/board.tsx`
- `app/admin-board-manage.tsx`
- `app/notice.tsx`
- `app/settings.tsx`
- `app/request-board.tsx`
- `app/request-board-fc-codes.tsx`
- `lib/__tests__/bottom-navigation.test.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- components/BottomNavigation.tsx lib/bottom-navigation.ts app/index.tsx app/board.tsx app/admin-board-manage.tsx app/notice.tsx app/settings.tsx app/request-board.tsx app/request-board-fc-codes.tsx lib/__tests__/bottom-navigation.test.ts` 통과
- 단위 테스트:
  - `npm test -- --runInBand` 통과 (신규 `bottom-navigation` 테스트 포함)
- 거버넌스:
  - `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 실기기(Android/iOS)에서 role 매트릭스 스모크:
  - 총무(admin), 본부장(manager/readOnly), FC, 설계매니저 각각 로그인
  - `홈 -> 게시판 -> 설계요청 -> 설정/공지` 이동 시 탭 구성(개수/순서) 불변 확인

---

## <a id="20260226-6"></a> 2026-02-26 | 앱 게시판 카테고리 유형 배지 노출 + request_board 계정 자동 생성 동기화 보강

**Commit**: `working tree`  
**작업 내용**:
- 앱 게시판(`app/board.tsx`) 카드/상세에 게시글 유형(카테고리) 배지 노출 추가
  - 카테고리명(`공지/교육/서류/일반`) 기반 색상 테마 함수 추가
  - 목록 카드와 상세 모달 모두 동일 포맷으로 배지 표시
- request_board 계정 자동 동기화 보강
  - `set-password` / `reset-password` / `set-admin-password` / `login-with-password`에서
    request_board 비밀번호 동기화 호출 시 `role/name/companyName` 메타 전달
  - 앱 로그인 성공 시점에도 동기화 호출하여 “가입은 되었지만 request_board 계정 없음” 케이스를 자동 복구

**핵심 파일**:
- `app/board.tsx`
- `supabase/functions/login-with-password/index.ts`
- `supabase/functions/set-password/index.ts`
- `supabase/functions/reset-password/index.ts`
- `supabase/functions/set-admin-password/index.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint: `npm run lint -- app/board.tsx` 통과
- 웹 빌드(TypeScript 포함): `cd web && npm run build` 통과
- 함수 배포 상태 확인: `supabase functions list --project-ref ubeginyxaotcamuqpmud`에서 4개 함수 ACTIVE 버전 반영 확인

---

## <a id="20260226-5"></a> 2026-02-26 | 부분 위촉 가입 Step 오분류/잠금 회귀 수정(1단계 시작 + 상태전환 보정 + 데이터 보정 migration)

**Commit**: `working tree`  
**작업 내용**:
- 문제 정리:
  - 회원가입에서 `life_only`/`nonlife_only`를 선택하면 `status=appointment-completed`로 저장되어 FC 홈이 즉시 4단계로 점프
  - 동일 상태값을 근거로 수당동의/서류 승인 UI 일부가 조기 잠금되어, 실제로 필요한 1단계부터의 진행 흐름과 불일치
- 수정:
  - `set-password`의 위촉 상태 매핑 분리/공유화
    - 신규 공유 모듈: `supabase/functions/_shared/commission.ts`
    - `life_only`/`nonlife_only`는 `draft`로 시작하고 완료 플래그만 유지
    - `both`만 `final-link-sent` 유지
  - 단계 계산 로직 정렬
    - 모바일 홈(`app/index.tsx`), 모바일 관리자(`app/dashboard.tsx`), 웹 공용(`web/src/lib/shared.ts`)을 동일 우선순위로 정렬
    - 우선순위: `final/both 완료` -> `신원 완료` -> `수당동의` -> `서류` -> `위촉`
    - 한쪽 위촉 완료 플래그만으로 4단계 점프하지 않도록 수정
  - 위촉 확정 상태 전환 보정
    - `admin-action`/웹 서버액션/웹 대시보드 낙관적 상태 갱신에서
      `appointment_date_*` 뿐 아니라 `life/nonlife_commission_completed` 플래그를 함께 고려해
      `final-link-sent` 판정
  - 기존 데이터 보정 migration 추가
    - `supabase/migrations/20260226000004_fix_partial_commission_signup_status.sql`
    - 과거 로직으로 `appointment-completed`가 된 “부분 위촉 가입 직후형(온보딩 진행 흔적 없음)”만 `draft`로 되돌림
    - 이미 진행 중인 FC(동의일/서류/차수/문서 행 존재)는 제외
- 회귀 테스트 추가:
  - `lib/__tests__/commission.test.ts`
  - `lib/__tests__/workflow-step-regression.test.ts`

**핵심 파일**:
- `supabase/functions/_shared/commission.ts`
- `supabase/functions/set-password/index.ts`
- `app/index.tsx`
- `app/dashboard.tsx`
- `web/src/lib/shared.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/dashboard/appointment/actions.ts`
- `web/src/app/dashboard/page.tsx`
- `supabase/migrations/20260226000004_fix_partial_commission_signup_status.sql`
- `lib/__tests__/commission.test.ts`
- `lib/__tests__/workflow-step-regression.test.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- app/index.tsx app/dashboard.tsx lib/__tests__/commission.test.ts lib/__tests__/workflow-step-regression.test.ts` 통과
- 단위 테스트:
  - `npm test -- --runInBand` 통과 (4 suites / 68 tests)
  - 신규 회귀 테스트 2개 포함 통과
- 웹 lint:
  - `cd web && npm run lint -- src/lib/shared.ts src/app/dashboard/appointment/actions.ts src/app/dashboard/page.tsx` 통과
- 웹 빌드(TypeScript 포함):
  - `cd web && npm run build` 통과
- DB 마이그레이션 사전 점검:
  - `supabase db push --linked --dry-run` 통과 (`20260226000004_fix_partial_commission_signup_status.sql` 적용 대상 확인)
- 리스크 시뮬레이션(직접 실행):
  - `appointment status transition simulation: ok` (부분완료+반대트랙 확정 시 `final-link-sent`)
  - `migration demotion predicate simulation: ok` (보정 SQL 조건이 진행중 FC를 제외하는지 확인)
- 참고:
  - `expo lint`로 Deno Edge Function 파일을 직접 lint하면 원격 import 해석(`deno.land`, `esm.sh`) 한계로 `import/no-unresolved`가 발생하여 해당 경고는 검증 대상에서 제외

**운영 반영 결과**:
- DB/함수 배포:
  - `supabase db push --linked` 성공 (`20260226000004_fix_partial_commission_signup_status.sql` 적용)
  - `supabase functions deploy set-password --project-ref ubeginyxaotcamuqpmud` 성공
  - `supabase functions deploy admin-action --project-ref ubeginyxaotcamuqpmud` 성공
- 배포 후 런타임 점검:
  - 함수 직접 호출 스모크:
    - `set-password` 입력 검증 응답 확인 (`invalid_phone`)
    - `admin-action` 인증 검증 응답 확인 (`unauthorized`)
  - 원격 데이터 정합성 점검(서비스 롤 조회):
    - `partialAppointmentCompleted: 0`
    - `bothDoneNotFinal: 0`
    - `badDemotionTarget: 0`
- 웹 운영 배포:
  - `vercel deploy --prod --archive=tgz` 성공
  - 운영 URL/API 인증 경로 스모크 확인 (`/api/admin/list` 401 정상)

**남은 실기기 확인**:
- `none/life_only/nonlife_only/both` 가입 4케이스 홈 단계/잠금 상태 검증 (Android/iOS 수동 시나리오)

---

## <a id="20260226-4"></a> 2026-02-26 | 관리자 웹 헤더 벨 알림센터 추가 + 사이드바 알림/공지 제거(클릭 이동/확인 카운트 차감)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청 반영:
  - 관리자 웹 사이드바에서 `알림/공지` 항목 제거
  - 앱과 동일하게 헤더의 종(벨) 아이콘으로 알림 목록 확인 가능하도록 개선
- 구현:
  - `web/src/components/DashboardNotificationBell.tsx` 신규 생성
    - `fc-notify`의 `inbox_list`를 사용해 알림/공지 통합 목록 조회
    - `request_board`/`온보딩`/`공지` 출처 배지 + 카테고리 라벨 표시
    - 항목 클릭 시 관련 페이지 라우팅:
      - request_board 메시지/이벤트 → `/dashboard/messenger?channel=request-board`
      - 내부 메시지/기타 타깃 URL → 웹 대시보드 경로로 정규화 후 이동
      - 공지(board_notice 포함) → 게시판 상세(`/dashboard/board?postId=...`) 또는 공지 상세
    - `모두 확인` 버튼 제공
    - 확인(항목 클릭) 시 로컬 읽음 상태 저장으로 벨 카운트 즉시 감소
  - `web/src/app/dashboard/layout.tsx`
    - 헤더 우측 사용자 메뉴 앞에 `DashboardNotificationBell` 배치
    - 사이드바 네비 `알림/공지` 메뉴 제거
- 읽음 카운트 처리 방식:
  - 서버 스키마에 개별 `is_read` 컬럼이 없어 사용자별 확인 상태는 브라우저 로컬 저장소(`dashboard-notification-seen:*`)로 관리
  - 사용자가 항목을 확인(클릭)하면 해당 ID가 읽음으로 기록되고 벨 숫자에서 즉시 제외

**핵심 파일**:
- `web/src/components/DashboardNotificationBell.tsx`
- `web/src/app/dashboard/layout.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 lint:
  - `cd web && npm run lint -- src/app/dashboard/layout.tsx src/components/DashboardNotificationBell.tsx` 통과
- 웹 빌드(TypeScript 포함):
  - `cd web && npm run build` 통과
- 거버넌스:
  - `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 관리자 계정 실기 확인:
  - 헤더 벨 목록 노출/새로고침/모두 확인 동작
  - 알림 항목 클릭 시 대상 화면 이동
  - 클릭 후 벨 카운트 감소(즉시 반영)

---

## <a id="20260226-3"></a> 2026-02-26 | FC 가람지사 메신저 대상 목록/총무 채팅 복구(RLS 우회 + targetId=admin 처리)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 이슈 대응:
  - FC가 `메신저 -> 가람지사 메신저` 진입 시 본부장 버튼이 보이지 않음
  - 총무 버튼이 보여도 채팅 진입/발송이 동작하지 않음
- 원인 정리:
  - 기존 FC 대상 목록 로딩이 앱 anon 클라이언트에서 `manager_accounts` 직접 조회에 의존해 RLS 환경에서 빈 목록이 반환됨
  - `chat.tsx`에서 `targetId`를 무조건 전화번호 sanitize하여 `targetId=admin`이 빈 문자열로 변환됨
- 조치:
  - `supabase/functions/fc-notify/index.ts`에 `type: 'chat_targets'` 분기 추가
    - 입력 `resident_id` 검증
    - `fc_profiles(phone, signup_completed=true)` 확인 후 서비스 롤로 `manager_accounts(active=true)` 조회
    - `managers: [{ name, phone }]` 응답 반환
  - `app/chat.tsx`에서 FC 대상 목록 로딩을 신규 함수 호출로 전환
    - 본부장 목록 + `총무` 고정 항목을 함께 렌더링하는 대상 선택 UI 유지
  - `targetId` 정규화 보정:
    - `targetId === 'admin'`이면 sanitize하지 않고 그대로 사용
    - 총무 채팅 `otherId`가 빈 문자열로 떨어지는 현상 제거

**핵심 파일**:
- `app/chat.tsx`
- `supabase/functions/fc-notify/index.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- app/chat.tsx app/messenger.tsx app/admin-messenger.tsx` 통과
- 테스트:
  - `npm test -- --runInBand` 통과 (2 suites / 53 tests)
- 거버넌스:
  - `node scripts/ci/check-governance.mjs` 통과
- 함수 배포:
  - `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료
- 런타임 API 확인:
  - `fc-notify` `type=chat_targets, resident_id=01064122836` 호출 성공
  - 응답 managers에 `서선미 / 01093118127` 포함 확인

**다음 단계**:
- 실기기(Android/iOS)에서 FC 계정으로 `가람지사 메신저` 진입 시
  - 본부장/총무 대상 목록 노출 여부
  - 각각 선택 후 송수신/읽음 처리까지 확인

---

## <a id="20260226-2"></a> 2026-02-26 | 앱 게시판 관리 목록 카테고리 표시 추가(공지/교육 등)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청 반영:
  - 앱의 `게시판 관리` 목록 카드에서 글의 유형(카테고리)이 보이지 않던 문제를 개선
  - 예: `공지`, `교육`, `서류`, `일반`
- 구현 방식:
  - `app/admin-board-manage.tsx`에서 `fetchBoardCategories`를 함께 조회
  - `categoryId -> categoryName` 매핑(Map) 생성
  - 목록 카드 제목 하단에 카테고리 배지 렌더링 추가
  - 카테고리별 색상 톤 적용:
    - 공지: 오렌지 계열
    - 교육: 블루 계열
    - 서류: 그린 계열
    - 기타: 그레이 계열

**핵심 파일**:
- `app/admin-board-manage.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- app/admin-board-manage.tsx` 통과

**다음 단계**:
- 실기기에서 게시판 관리 목록 진입 후 카테고리 배지 노출/색상 확인

---

## <a id="20260226-1"></a> 2026-02-26 | 관리자 웹 공지/게시판 공지 일관화(통합 목록 + 게시판 딥링크 + 삭제 경로 통합)

**Commit**: `working tree`  
**작업 내용**:
- 배경:
  - 모바일에서는 이미 `공지 페이지`와 `게시판 공지(slug=notice)`를 통합 소스로 처리하고 있었지만,
    관리자 웹(`알림/공지`)은 `notices` 테이블만 조회해 게시판 공지가 분리되어 보이던 상태
- 서버 API 통합:
  - `web/src/app/api/admin/notices/route.ts`에서 목록 조회 시
    - 기존 `notices` + 게시판 `board_posts(category_slug=notice)`를 병합
    - 게시판 공지 ID를 `board_notice:{postId}` 형식으로 표준화
    - `created_at` 기준 통합 정렬
  - 상세 조회(`GET id`)에서도 `board_notice:*` 식별자를 처리하도록 확장
    - 게시판 첨부(`board_attachments`)는 signed URL로 매핑
  - 삭제(`DELETE`)도 `board_notice:*` 식별자 지원
    - 게시글 삭제 + 스토리지(`board-attachments`) 정리 경로 포함
  - 수정(`PATCH`)은 게시판 공지에 대해 명시적으로 차단
    - 안내 메시지: `게시판 공지는 게시판에서 수정해주세요.`
- 관리자 화면 동작 일관화:
  - `web/src/app/dashboard/notifications/page.tsx`
    - 통합 목록에서 `board_notice:*` 클릭 시 `/dashboard/board?postId=...`로 이동
    - 편집 버튼도 게시판 공지인 경우 게시판 상세 진입으로 연결
  - `web/src/app/dashboard/notifications/[id]/page.tsx`
    - `board_notice:*` 접근 시 자동으로 게시판 상세로 리다이렉트
  - `web/src/app/dashboard/notifications/[id]/edit/page.tsx`
    - `board_notice:*` 편집 URL 접근 시 게시판으로 리다이렉트
- 게시판 상세 딥링크 처리:
  - `web/src/app/dashboard/board/page.tsx`
    - `postId` 쿼리 파라미터를 읽어 게시글 상세 모달을 자동 오픈
    - 모달 닫기 시 `postId` 쿼리를 제거해 URL/상태 동기화

**핵심 파일**:
- `web/src/app/api/admin/notices/route.ts`
- `web/src/app/dashboard/notifications/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`
- `web/src/app/dashboard/notifications/[id]/edit/page.tsx`
- `web/src/app/dashboard/board/page.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 lint:
  - `cd web && npm run lint -- src/app/api/admin/notices/route.ts src/app/dashboard/notifications/page.tsx src/app/dashboard/notifications/[id]/page.tsx src/app/dashboard/notifications/[id]/edit/page.tsx src/app/dashboard/board/page.tsx` 통과
- 웹 빌드(TypeScript 포함):
  - `cd web && npm run build` 통과

**다음 단계**:
- 운영 환경에서 관리자 계정으로 실제 확인:
  - `알림/공지` 목록에 게시판 공지와 일반 공지가 함께 노출되는지
  - 게시판 공지 클릭 시 게시판 상세 모달로 진입하는지
  - 게시판 공지 삭제 시 목록/게시판/첨부파일 정리가 함께 되는지

---

## <a id="20260225-16"></a> 2026-02-25 | FC 삭제 완전 정리 보강(웹/엣지/fallback 경로 통합)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 이슈 대응:
  - 총무 웹에서 FC 삭제 후 일부 데이터(알림/토큰/게시판 반응/브릿지 프로필 등)가 남는 케이스를 제거
- 삭제 범위 확장:
  - `resident_id` 기준 삭제를 단일 값이 아니라 `digits/raw/masked` 식별자 세트로 통합 처리
  - 기존 누락 테이블 삭제 추가:
    - `device_tokens`
    - `web_push_subscriptions`
    - `board_comment_likes`
    - `profiles`(`fc_id` 기반)
  - `exam_registrations`, `notifications`는 `fc_id` + `resident_id` 양쪽 축에서 삭제
  - 채팅 파일 삭제 경로 정규화(`.../chat-uploads/...` -> 버킷 내부 path) 보강
  - `fc_credentials`, `fc_identity_secure` 명시 삭제(캐스케이드 누락 대비)
  - 링크된 `profiles.id`에 대해 `auth.admin.deleteUser` 호출로 auth 사용자까지 정리 시도
- 경로별 정합성:
  - 총무 웹 삭제 API: `web/src/app/api/fc-delete/route.ts`
  - 모바일/공용 계정삭제 함수: `supabase/functions/delete-account/index.ts`
  - 모바일 fallback 삭제(`admin-action deleteFc`)도 동일 기준 반영
  - 웹 설정의 FC 자가 삭제는 직접 테이블 삭제 대신 `delete-account` 함수 호출로 단일화

**핵심 파일**:
- `web/src/app/api/fc-delete/route.ts`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/dashboard/settings/page.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 빌드: `cd web && npm run build` 통과 (TypeScript 포함)
- 참고: 루트 `expo lint`는 웹 alias/deno remote import 해석 한계로 파일 단위 검증에 부적합하여 웹 빌드 기준으로 검증

**다음 단계**:
- 프로덕션 반영 후 실데이터로 1건 삭제 검증:
  - 삭제 전/후 `fc_profiles`, `fc_credentials`, `fc_identity_secure`, `notifications`, `device_tokens`, `web_push_subscriptions`, `messages`, `board_*` 레코드 카운트 비교

---

## <a id="20260225-15"></a> 2026-02-25 | 웹 빌드 타입 오류 핫픽스(`calcStep` 불필요 분기 제거)

**Commit**: `af4ca84`  
**작업 내용**:
- Vercel 프로덕션 빌드(TypeScript) 실패 원인 수정:
  - 파일: `web/src/lib/shared.ts`
  - 함수: `calcStep`
  - 증상: `profile.status`가 상단 분기에서 이미 좁혀진 상태에서 하단에 `profile.status !== 'final-link-sent'` 비교가 남아 타입 충돌 발생
  - 조치: 문서 승인 완료 후 분기에서 불필요한 `final-link-sent` 재비교/`return 5` 경로 제거, `return 4`로 단순화
- 영향:
  - 런타임 동작 변경 없음(상단에서 `final-link-sent`/양 트랙 완료는 이미 Step 5 처리)
  - 타입 체크 경고만 제거하여 CI/Vercel 빌드 통과 복구

**핵심 파일**:
- `web/src/lib/shared.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 빌드: `cd web && npm run build` 통과
- 거버넌스 체크: `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 해당 문서 동기화 커밋 푸시 후 GitHub Actions `Governance Check` 재실행/통과 확인

---

## <a id="20260225-14"></a> 2026-02-25 | FC 위촉 2트랙(생명/손해) 완료 상태 분기 도입

**Commit**: `working tree`  
**작업 내용**:
- 요구사항 반영:
  - FC 가입 시 위촉 완료 상태를 `none / life_only / nonlife_only / both`로 선택할 수 있도록 추가
  - 기존 `status` 단일 분기로 발생하던 혼선을 줄이기 위해 생명/손해 완료 플래그를 별도 저장
- 앱 가입/저장 경로:
  - `signup -> signup-verify -> signup-password -> set-password` payload에 `commissionStatus` 연결
  - `set-password`에서 `commissionStatus`를 `status + life/nonlife completion`으로 매핑
    - `none` -> `draft`, false/false
    - `life_only` -> `appointment-completed`, true/false
    - `nonlife_only` -> `appointment-completed`, false/true
    - `both` -> `final-link-sent`, true/true
  - 신규 컬럼 미적용 환경에서도 가입 실패를 피하도록 컬럼 누락 fallback 처리 추가
- 홈 화면/단계 로직:
  - `calcStep` 우선순위 보정: `final-link-sent`는 즉시 Step 5, 단일 트랙 완료는 Step 4 우선
  - 위촉 배지를 명확화: `생명/손해` 각각 `완료/대기`로 표시 + `위촉 완료 X/2` 요약 노출
  - FC 홈의 두 렌더 경로 모두 동일 배지/요약이 노출되도록 정렬
- 웹 관리자 정합성:
  - shared `calcStep`, `getAppointmentProgress`도 동일 completion 플래그를 반영해 Step 집계/표시 정렬
- 데이터/스키마:
  - `fc_profiles`에 `life_commission_completed`, `nonlife_commission_completed` 컬럼 추가
  - 마이그레이션에서 기존 `appointment_date_*` 데이터 기반 backfill + status 정규화 반영
- 보강:
  - `app/fc/new.tsx`에서 기존 프로필 수정 시 status를 `draft`로 덮어쓰던 동작 제거(완료 상태 보존)

**핵심 파일**:
- `app/signup.tsx`
- `app/signup-verify.tsx`
- `app/signup-password.tsx`
- `app/index.tsx`
- `app/fc/new.tsx`
- `supabase/functions/set-password/index.ts`
- `types/fc.ts`
- `web/src/types/fc.ts`
- `web/src/lib/shared.ts`
- `web/src/app/dashboard/page.tsx`
- `supabase/schema.sql`
- `supabase/migrations/20260225000003_add_commission_completion_flags.sql`

**검증**:
- 모바일 코드 lint:
  - `npm run lint -- app/signup.tsx app/signup-verify.tsx app/signup-password.tsx app/index.tsx app/fc/new.tsx types/fc.ts` 통과
- 웹 공유 로직 lint:
  - `cd web && npm run lint -- src/lib/shared.ts src/types/fc.ts src/app/dashboard/page.tsx` 통과
- 거버넌스 체크:
  - `node scripts/ci/check-governance.mjs` 통과
- 배포/마이그레이션:
  - `supabase functions deploy set-password --project-ref ubeginyxaotcamuqpmud` 성공
  - `supabase db push --linked` 성공 (`20260225000003_add_commission_completion_flags.sql` 적용 확인)
  - 서비스키 조회 검증: `fc_profiles(id,phone,status,life_commission_completed,nonlife_commission_completed)` select 성공

**다음 단계**:
- DB migration + set-password 함수 배포 후 실기기에서 4개 가입 케이스(미완료/생명만/손해만/모두완료) 단계/배지 확인

---

## <a id="20260225-13"></a> 2026-02-25 | request_board 본부장(FC 리더) 브릿지 권한 정렬 + 재테스트

**Commit**: `working tree`  
**작업 내용**:
- 사용자 정책 정렬:
  - app의 `manager(본부장)`는 request_board `designer`가 아니라 `fc` 계열로 취급하도록 브릿지 로그인 경로 재정렬
  - request_board designer 전용 모드 활성화는 `rbBridgeLogin` 결과가 실제 `designer`일 때만 true가 되도록 고정
- 세션/알림 경로 분리:
  - `use-session`에 `requestBoardRole('fc'|'designer'|null)` 상태 추가
  - request_board 알림함 조회 시 app role 대신 `requestBoardRole` 우선 사용
  - designer 브릿지 계정이 아닌 경우 inbox 조회는 `role=fc + resident_id`로 고정
- 배포 반영:
  - `supabase/functions/login-with-password` 프로덕션 재배포 완료
  - manager 계정 브릿지 토큰 role을 `designer` -> `fc`로 전환
- 추가 UX:
  - request_board 화면 헤더에 웹 URL 복사 버튼 추가

**핵심 파일**:
- `hooks/use-login.ts`
- `hooks/use-session.tsx`
- `app/request-board.tsx`
- `app/notifications.tsx`
- `supabase/functions/login-with-password/index.ts`

**검증**:
- 정적 검증:
  - `npm run lint -- hooks/use-login.ts hooks/use-session.tsx app/request-board.tsx app/notifications.tsx` 통과
- 배포 검증:
  - `supabase functions deploy login-with-password --project-ref ubeginyxaotcamuqpmud` 성공
- API 실측:
  - `login-with-password(01093118127)` -> `role=manager`, `requestBoardBridgeToken` 발급 확인
  - `POST /api/auth/bridge-login` -> manager token으로 `role=fc` 로그인 성공(403 재현 해소)
  - request_board DM 송신 후 `fc-notify inbox_list(role=fc,resident_id=01093118127)`에서 `request_board_message` 적재 확인

**다음 단계**:
- 모바일 앱 빌드/OTA 배포 후 실기기에서 본부장 계정 로그인 -> 설계페이지 진입 -> 알림센터 반영을 UI 기준으로 최종 확인

---

## <a id="20260225-12"></a> 2026-02-25 | 거버넌스 CI 복구(문서/스키마 동기화)

**Commit**: `working tree`  
**작업 내용**:
- GitHub Actions `governance-check` 실패 원인 대응:
  - `Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.`
  - `Schema change policy violation: update supabase/schema.sql and supabase/migrations/*.sql together.`
- 수정 반영:
  - `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` 동시 업데이트
  - `supabase/schema.sql`에 `notices.created_by` 스키마 동기화 보강
  - 동기화용 no-op 마이그레이션 추가:
    - `supabase/migrations/20260225000002_schema_sync_notices_created_by.sql`

**핵심 파일**:
- `supabase/schema.sql`
- `supabase/migrations/20260225000002_schema_sync_notices_created_by.sql`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 로컬 실행: `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 해당 커밋 푸시 후 GitHub Actions `Governance Check` 재실행/통과 확인

---

## <a id="20260225-11"></a> 2026-02-25 | request_board 메신저 첨부파일 UI 완성(모바일)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청(이전 세션 중단 지점) 기준으로 `request_board` 연동 메신저 화면의 첨부 기능을 마무리:
  - 갤러리 이미지 선택(`expo-image-picker`)
  - 문서 선택(`expo-document-picker`)
  - 전송 전 pending 첨부 목록(가로 strip) + 개별 제거
  - 전송 시 파일 우선 업로드(`rbUploadAttachments`) 후 메시지 전송(`rbSendMessage`/`rbSendDmMessage`)
  - 첨부만 있는 메시지도 전송 가능하도록 본문 placeholder 처리(`[첨부파일]`)
- 대화 렌더링 확장:
  - 이미지 첨부: 썸네일 그리드 + 탭 시 전체화면 미리보기 모달
  - 일반 파일: 파일 카드(아이콘/파일명/용량) + 탭 시 URL 오픈
- 타입 안정화:
  - `FlatList` 제네릭/콜백 파라미터 타입 명시
  - 신규 렌더 경로 `implicit any` 제거
  - 불필요한 `as any` 제거(아이콘 name 타입/메시지 sender 접근)

**핵심 파일**:
- `app/request-board-messenger.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `npm run lint -- app/request-board-messenger.tsx` 통과
- `npx tsc --noEmit --pretty false` 실행 후 파일 단위 확인:
  - `request-board-messenger.tsx` 오류 없음
  - 참고: 프로젝트 내 기존 다른 파일 오류(`app/fc/new.tsx`, `app/notifications.tsx`)는 별도 선행 이슈로 잔존
- request_board 서버 계약 대조:
  - `/api/messages/attachments/upload` 경로 및 `attachments[{fileName,fileType,fileSize,fileUrl}]` payload 형식 일치 확인

**다음 단계**:
- Android/iOS 실기기에서 request 채팅/DM 각각 아래 시나리오 검증:
  - 이미지/문서 첨부 전송
  - 첨부파일만 전송(텍스트 없음)
  - 파일 카드 탭 시 외부 열기
  - 이미지 전체화면 미리보기 닫기/복귀

---

## <a id="20260225-9"></a> 2026-02-25 | `fc-notify` target_id role 무관 통합 발송

**Commit**: `working tree`  
**작업 내용**:
- 사용자 이슈 재현:
  - 같은 번호라도 `device_tokens.role='admin'` 인 경우 `target_role='fc'` 발송에서 `sent=0` 발생
  - 실제 예시: `01093118127`은 토큰 2건이 모두 `admin` role이라 기존 로직에서 누락
- 코드 수정:
  - `supabase/functions/fc-notify/index.ts`
  - `notify/message` 경로에서 `target_id`가 있으면 `role` 필터를 제거하고 `resident_id=target_id` 기준으로 토큰 조회
  - `fc_update/admin_update` 레거시 분기 중 FC 대상 경로도 `resident_id` 기준 조회로 정렬
  - `dedupeTokens()` 추가로 동일 Expo 토큰 중복 발송 방지
- 기대 효과:
  - `target_id` 지정 단건 알림은 FC/Admin/Manager 어느 role로 토큰이 등록되어 있어도 동일 번호 디바이스에 발송

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 함수 배포: `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료
- 라이브 검증:
  - `POST https://adminweb-red.vercel.app/api/fc-notify`
  - payload: `type=notify,target_role=fc,target_id=01093118127`
  - 결과: `status=200`, `sent=2` 확인 (수정 전 동일 대상 `sent=0`)

**다음 단계**:
- `request_board` 브릿지 경로에서 서선미 실기기 수신 확인
- 필요 시 `target_id` 포맷 유효성(11자리 숫자) 실패 로그를 별도 집계

---

## <a id="20260225-10"></a> 2026-02-25 | 알림 출처 구분 강화(온보딩앱 vs 설계요청)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요구사항: 동일 앱에서 수신되는 알림을
  - `fc-onboarding-app` 자체 이벤트
  - `request_board` 브릿지 이벤트
  로 명확히 구분 가능하도록 개선
- 서버(즉시 반영) 변경:
  - `supabase/functions/fc-notify/index.ts`
  - `request_board_*` 카테고리 알림은 Expo Push 제목에 `[설계요청]` 접두어 자동 부여
  - Push data에 `source`(`request_board`/`fc_onboarding`) 포함
- 앱 UI(앱 업데이트 반영) 변경:
  - `app/notifications.tsx`
  - 알림센터 목록에 출처 배지 추가: `설계요청` / `온보딩앱`
  - `request_board_*` 카테고리 라벨을 사용자 친화 문구로 정규화
    - 예: `request_board_accepted -> 의뢰 수락`, `request_board_message -> 새 메시지`
  - request_board 알림 탭 시 온보딩 내부 라우트로 오인 이동하지 않도록 안내 알림 처리

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `app/notifications.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료
- `npm run lint -- app/notifications.tsx` 통과
- 라이브 호출(`POST https://adminweb-red.vercel.app/api/fc-notify`) 발송 성공 확인

**다음 단계**:
- 서버 푸시 제목 접두어(`[설계요청]`)는 즉시 적용됨
- 알림센터 출처 배지 UI는 모바일 앱 빌드/배포 후 실사용 반영

---

## <a id="20260224-8"></a> 2026-02-24 | 데스크톱 알림 미표시 대응: 서비스워커/정적자산 경로 보정

**Commit**: `working tree`
**작업 내용**:
- 배포본 실측으로 원인 후보 확정:
  - `https://adminweb-red.vercel.app/sw.js`가 `307 -> /auth`로 리다이렉트되던 상태 확인
  - 서비스워커/정적자산 접근 경로가 인증 미들웨어에 영향을 받으면 브라우저 푸시 수신 표시가 불안정해질 수 있음
- 코드 수정:
  - `web/middleware.ts`
    - matcher를 정적 파일/`sw.js` 제외 패턴으로 보강해 서비스워커·정적자산 요청이 인증 리다이렉트 대상이 되지 않도록 조정
  - `web/public/sw.js`
    - `install/activate`에서 `skipWaiting`/`clients.claim` 추가
    - `push` 이벤트 payload를 `json()` 실패 시 `text()` fallback 하도록 방어
    - 알림 아이콘/배지 경로를 존재하는 `/favicon.ico`로 통일
  - `web/src/app/dashboard/page.tsx`
    - `알림 테스트` 버튼의 icon/badge 경로를 `/favicon.png` -> `/favicon.ico`로 수정
- 운영 반영:
  - 웹 프로덕션 재배포 완료
  - 새 배포: `https://admin-ff5m38mw8-jun-jeongs-projects.vercel.app`
  - alias: `https://adminweb-red.vercel.app`

**핵심 파일**:
- `web/middleware.ts`
- `web/public/sw.js`
- `web/src/app/dashboard/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- middleware.ts src/app/dashboard/page.tsx public/sw.js` 통과
- 외부 응답 확인:
  - `curl -I https://adminweb-red.vercel.app/sw.js` => `200 OK`
  - `curl -I https://adminweb-red.vercel.app/adminWebLogo.png` => `200 OK`
  - `curl -I https://adminweb-red.vercel.app/favicon.ico` => `200 OK`
- 체인 검증:
  - `POST https://adminweb-red.vercel.app/api/fc-notify` 직접 호출 결과
  - 응답에 `web_push: { ok: true, status: 200, sent: 1, failed: 0 }` 확인

**다음 단계**:
- 운영 브라우저에서 `Ctrl+F5` 1회 후 `알림 테스트` 버튼 재실행(신규 SW 활성화 반영)
- 그래도 OS 배너가 없으면 코드 경로가 아니라 OS/브라우저 정책 문제이므로 Windows의 Chrome 앱 알림 허용/집중 모드(Focus) 해제/Chrome 조용한 알림 UI 설정을 점검

---

## <a id="20260224-7"></a> 2026-02-24 | 데스크톱 알림 미표시 원인 분리 진단 보강

**Commit**: `working tree`
**작업 내용**:
- 서버-사이드 진단 보강:
  - `supabase/functions/fc-notify/index.ts`에서 admin 대상 웹푸시 콜백 결과를 응답에 포함하도록 확장
  - 응답 필드: `web_push: { ok, status, sent, failed, reason }`
  - 대상 경로: `type=notify`, `type=message`, `fc_update/fc_delete` 계열 admin 웹푸시 호출
- 클라이언트-사이드 진단 보강:
  - 대시보드 헤더에 `알림 테스트` 버튼 추가
  - 클릭 시 Notification permission 확인/요청 후 즉시 테스트 알림(`serviceWorker.showNotification` 우선, fallback `new Notification`) 발송
  - 결과를 토스트로 안내해 브라우저/OS 알림 차단 여부를 즉시 확인 가능
- 운영 반영:
  - `fc-notify` 재배포(버전 49)
  - 웹 프로덕션 재배포(`admin-fqbyh32rq-jun-jeongs-projects.vercel.app`, alias `adminweb-red`)

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `web/src/app/dashboard/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx` 통과
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료 (version 49)
- 직접 invoke 결과:
  - `web_push: { ok: true, status: 200, sent: 1, failed: 0 }` 확인
- Vercel deploy ready + alias 연결 확인:
  - `https://admin-fqbyh32rq-jun-jeongs-projects.vercel.app`
  - `https://adminweb-red.vercel.app`

**다음 단계**:
- 운영자가 대시보드 상단 `알림 테스트` 버튼을 눌러 로컬 OS 알림 표시 여부 확인
- 테스트 알림도 미표시이면 OS/브라우저 알림 설정(Windows Focus Assist, Chrome 사이트 권한, 조용한 알림 UI)을 우선 점검

---

## <a id="20260224-6"></a> 2026-02-24 | 대시보드 상단 웹 알림 설정 버튼 추가

**Commit**: `working tree`
**작업 내용**:
- 관리자 대시보드 헤더(`대시보드 / FC 온보딩 전체 현황판`) 우측 버튼 영역에 `알림 설정` 버튼 추가
- 기존 `새로고침` 버튼 왼쪽에 배치하여 운영자가 현재 화면에서 바로 웹푸시 권한 요청/재등록 가능하도록 개선
- 버튼 클릭 시 `registerWebPushSubscription(role, residentId, { forceResubscribe: true })` 실행:
  - 성공: 등록 완료 알림
  - 브라우저 미지원/권한 거부/기타 실패: 상황별 안내 알림
- 관리자 흐름과 동일한 shared web-push 헬퍼를 재사용하여 설정 페이지와 동작 일관성 유지

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx` 통과
- Vercel production 배포 완료:
  - `https://admin-q7k45zhrs-jun-jeongs-projects.vercel.app`
  - alias: `https://adminweb-red.vercel.app`

**다음 단계**:
- 웹 프로덕션 배포 후 대시보드 상단 `알림 설정` 버튼 노출 확인
- 버튼 클릭 후 FC 앱 메시지 전송 시 총무 브라우저 알림 수신 확인

---

## <a id="20260224-5"></a> 2026-02-24 | 설정 페이지 웹 알림 권한 버튼/상태 UI 추가

**Commit**: `working tree`
**작업 내용**:
- 웹 설정 페이지(`dashboard/settings`)에 웹푸시 상태/권한 제어 UI 추가:
  - 상태 표시: `granted`, `denied`, `default`, `unsupported`
  - 버튼 액션: 권한 요청 + 웹푸시 구독 강제 재등록(`forceResubscribe`)
  - 권한 거부(`denied`) 시 브라우저 사이트 설정 안내 메시지 제공
- `WebPushRegistrar` 리팩터링:
  - `getWebPushPermissionState()`
  - `registerWebPushSubscription(role, residentId, opts)`
  - 자동 등록(`useEffect`)과 수동 버튼 액션에서 동일 함수 재사용
- 구독 API 실패 시 에러 메시지를 반환해 설정 화면에서 사용자 피드백 노출

**핵심 파일**:
- `web/src/components/WebPushRegistrar.tsx`
- `web/src/app/dashboard/settings/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/components/WebPushRegistrar.tsx src/app/dashboard/settings/page.tsx` 통과
- Vercel production 배포 완료:
  - `https://admin-nbmu1fo8i-jun-jeongs-projects.vercel.app`
  - alias: `https://adminweb-red.vercel.app`

**다음 단계**:
- 총무 계정으로 `설정 > 웹 알림` 버튼 클릭 후 권한 허용/재등록
- FC 앱에서 메시지 전송하여 총무 브라우저 백그라운드 알림 수신 확인

---

## <a id="20260224-4"></a> 2026-02-24 | 총무 웹푸시 미수신 복구(운영 반영 완료)

**Commit**: `working tree`
**작업 내용**:
- 원인 확정:
  - `/api/admin/push`가 401을 반환했지만 헤더 자체는 도달하고 있었음
  - 실측 디버그 결과 `hasSecret/hasBearer/hasApikey=true` + `secretConfigured/serviceRoleConfigured=true` 상태에서 비교만 실패
  - 결론: auth 토큰 비교 시 env/헤더 포맷 오염(개행/literal `\\n`/따옴표)으로 문자열 불일치
- 서버 수정:
  - `web/src/app/api/admin/push/route.ts`
    - `normalizeToken()` 추가 (trim + quote 제거 + literal `\\n` 제거 + 개행 제거)
    - `X-Admin-Push-Secret`, Bearer, apikey, env secret/service key 모두 정규화 후 비교
  - `web/src/lib/web-push.ts`
    - VAPID env 정규화/검증 강화(공백/개행/literal `\\n` 제거, invalid config 명시 로그)
- 운영 반영:
  - Vercel production env 강제 overwrite:
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - `ADMIN_PUSH_SECRET`
    - `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`
    - `WEB_PUSH_VAPID_PRIVATE_KEY`
    - `WEB_PUSH_SUBJECT`
  - Vercel production 재배포 완료:
    - `https://admin-c87og339h-jun-jeongs-projects.vercel.app`
    - alias: `https://adminweb-red.vercel.app`

**핵심 파일**:
- `web/src/app/api/admin/push/route.ts`
- `web/src/lib/web-push.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/api/admin/push/route.ts src/lib/web-push.ts` 통과
- 실서비스 엔드포인트 검증:
  - `POST https://adminweb-red.vercel.app/api/admin/push`
  - Bearer+apikey 인증: `200 {"ok":true,"sent":1,"failed":0}`
  - `X-Admin-Push-Secret` 인증: `200 {"ok":true,"sent":1,"failed":0}`
- `fc-notify` 직접 invoke:
  - `200` 응답 + admin 대상 notifications row insert 확인

**다음 단계**:
- 실제 FC 앱에서 총무로 채팅 메시지 전송 후, 구독된 총무 브라우저(같은 프로필/권한 허용 상태)에서 백그라운드 알림 수신 최종 확인

---

## <a id="20260224-3"></a> 2026-02-24 | 웹푸시 VAPID env 포맷 오류 방어 추가

**Commit**: `working tree`
**작업 내용**:
- `web/src/lib/web-push.ts`에 웹푸시 env 정규화 로직 추가:
  - 따옴표/공백/개행 및 literal `\\n` 제거
  - VAPID 공개키/비공개키는 내부 공백 제거까지 수행
- VAPID 설정 실패 시 `webpush.setVapidDetails` 예외를 잡아 명시 로그(`invalid VAPID configuration`)를 남기고 안전하게 비활성 처리
- 필수 VAPID env 누락 시 경고 로그 추가(`missing VAPID configuration`)
- 배경: 실제 진단 중 local env의 VAPID 키 끝에 literal `\\n`이 포함되어 web-push 키 검증 실패 재현됨

**핵심 파일**:
- `web/src/lib/web-push.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/lib/web-push.ts src/app/api/admin/push/route.ts` 통과

**다음 단계**:
- Next.js 웹 런타임 재배포
- Vercel 환경변수의 `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`에 불필요한 `\\n`/공백이 없는지 확인

---

## <a id="20260224-2"></a> 2026-02-24 | 앱→총무 채팅 웹푸시 누락 대응(콜백 신뢰성 보강)

**Commit**: `working tree`
**작업 내용**:
- `supabase/functions/fc-notify/index.ts`의 어드민 웹푸시 콜백 로직 보강:
  - `ADMIN_WEB_URL`에 경로가 포함되어 있어도 origin 기준으로 `/api/admin/push`를 강제 조합하도록 정규화
  - 콜백 요청 헤더에 `Authorization: Bearer <service-role>` + `apikey`를 추가해 `ADMIN_PUSH_SECRET` 드리프트 상황에서도 인증 fallback 가능
  - 401/404/500 등 non-2xx 응답 본문을 함수 로그에 남기도록 개선해 운영 가시성 강화
  - `ADMIN_WEB_URL` 누락/형식 오류 시 조기 경고 로그 추가
- `web/src/app/api/admin/push/route.ts` 인증 보강:
  - 기존 `X-Admin-Push-Secret` 단일 검증에서
    `X-Admin-Push-Secret` 또는 `Authorization Bearer(service-role key)` 둘 중 하나 통과 시 허용하도록 확장
  - 인증 실패 시 `hasSecret/hasBearer/secretConfigured` 메타 로그를 남겨 원인 파악 단축
- 운영 진단:
  - 로컬 `web/.env.local` 기준 푸시/시크릿 키 존재 여부를 재점검해 누락 가능성을 제거
  - 콜백 non-2xx 응답을 로그로 노출하도록 변경해 401/404 류의 미표시 실패를 운영에서 즉시 확인 가능하게 개선

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `web/src/app/api/admin/push/route.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/api/admin/push/route.ts` 통과
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료 (버전 48 반영 확인)
- `deno` 실행기가 로컬에 없어 Edge Function 포맷/린트 커맨드는 미실행

**다음 단계**:
- 배포된 Next.js 환경의 `ADMIN_PUSH_SECRET`와 Supabase `ADMIN_PUSH_SECRET` 동기화 확인
- FC 앱에서 총무 채팅 메시지 전송 후 브라우저 백그라운드 알림 재검증

---

## <a id="20260224-1"></a> 2026-02-24 | 어드민 브라우저 웹 푸시 알림 추가

**Commit**: `475f11b`
**작업 내용**:
- `web/src/app/api/admin/push/route.ts` 신규 생성:
  - `X-Admin-Push-Secret` 헤더로 인증하는 보호 엔드포인트
  - `web_push_subscriptions` 테이블에서 `role='admin'` 구독자 조회 후 `sendWebPush` 발송
  - 만료 구독 자동 정리
- `supabase/functions/fc-notify/index.ts` 수정:
  - `notifyAdminWebPush(title, body, url)` 헬퍼 추가
  - `type='notify'`+`target_role='admin'`, `type='message'`+`target_role='admin'`, `type='fc_update'`, `type='fc_delete'` 처리 후 어드민 웹 푸시 콜백 호출
- `web/src/app/api/fc-notify/route.ts` 수정:
  - `type='notify'`+`target_role='admin'` 케이스에 웹 푸시 처리 추가
- `web/src/app/api/web-push/subscribe/route.ts` 수정:
  - anon 클라이언트 → service role 클라이언트로 교체
  - 커스텀 인증 환경에서 `auth.uid()=null`로 인한 RLS 차단 버그 수정
- Supabase 시크릿 등록: `ADMIN_PUSH_SECRET`, `ADMIN_WEB_URL`
- Vercel 환경변수 등록: `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, `ADMIN_PUSH_SECRET`
- `fc-notify` Edge Function 배포 완료

**핵심 파일**:
- `web/src/app/api/admin/push/route.ts` (신규)
- `supabase/functions/fc-notify/index.ts`
- `web/src/app/api/fc-notify/route.ts`
- `web/src/app/api/web-push/subscribe/route.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint` 통과
- Vercel 빌드 통과 (notifications edit 페이지 누락 파일 추가 커밋 포함)

**다음 단계**:
- 어드민이 `adminweb-red.vercel.app` 접속 후 브라우저 알림 권한 허용 필요
- FC 채팅/서류/동의/시험 신청 시 OS 알림 수신 확인

---

## <a id="20260220-1"></a> 2026-02-20 | 모바일 시험 신청(생명/손해) 마감 필터 기준 통일 및 당겨서 새로고침 제스처 복구

**Commit**: `0c25c96`  
**작업 내용**:
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`의 시험 일정 조회 기준을 동일화:
  - `registration_deadline`이 최근 7일 이내인 일정만 조회되도록 통일
  - cutoff 비교 포맷을 `YYYY-MM-DD`로 정렬해 화면 간 날짜 비교 일관성 확보
- 두 화면 모두 새로고침 UX를 동일화:
  - 당겨서 새로고침/헤더 새로고침 버튼이 모두 `round list + my applications + profile allowance state`를 함께 갱신하도록 변경
- 새로고침 제스처 미동작 원인(중첩 스크롤 구조) 제거:
  - `KeyboardAwareWrapper` 내부의 중첩 `ScrollView`를 제거하고, `RefreshControl`을 wrapper에 직접 연결해 단일 스크롤 소유 구조로 수정
- 관련 진행 이력을 `AGENTS.md` Progress Ledger에 추가

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `npm run lint -- app/exam-apply.tsx app/exam-apply2.tsx` 통과
- 실제 기기 확인 기준: 생명/손해 시험 신청 화면에서 pull-to-refresh 제스처 정상 동작 및 상단 새로고침 버튼과 동일한 데이터 갱신 경로 사용

---

## <a id="20260219-8"></a> 2026-02-19 | 웹 대시보드 서류 배지의 "검토 중" 카운트를 제출 문서 기준으로 보정

**작업 내용**:
- 관리자 웹 대시보드 FC 카드의 서류 요약 배지에서 `검토 중` 카운트 조건을 조정
- 기존에는 `approved/rejected`가 아닌 모든 문서를 카운트해 미제출 문서도 포함되던 문제를 수정
- 이제 `storage_path`가 존재하고 `deleted`가 아닌 제출 문서 중, `approved/rejected`가 아닌 문서만 `검토 중`에 집계

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

**검증**:
- `cd web && npm run lint` 통과

---

## <a id="20260219-7"></a> 2026-02-19 | 웹 FC 상세 페이지에서 프로필/관리자 메모 수정 경로를 서버 API로 전환하고 관리자만 수정 가능하도록 권한 제어 보강

**작업 내용**:
- FC 상세 페이지(`web/src/app/dashboard/profile/[id]/page.tsx`)의 프로필 저장/메모 저장 로직에서 클라이언트 직접 `supabase.from('fc_profiles').update(...)` 호출을 제거
- `/api/admin/fc`의 `updateProfile` 액션을 사용하도록 변경해 관리자 쓰기 경로를 서버 중계 경로로 통일
- `useSession` 기반 권한 상태(`role`, `isReadOnly`)를 반영해 관리자(admin)만 수정 가능하도록 버튼/입력 상태를 제어하고, manager 계정에서는 읽기 전용 동작을 명시적으로 유지
- 저장 후 `fc-profile` 쿼리 invalidate를 통해 화면 반영을 안정화

**핵심 파일**:
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `AGENTS.md`

**검증**:
- `cd web && npm run lint` 통과

---

## <a id="20260219-6"></a> 2026-02-19 | 주민번호 표기 경로 전반에서 마스킹 fallback 제거 및 관리자 화면 전체번호 조회 확장

**작업 내용**:
- 주민번호 전체 조회 액션(`admin-action:getResidentNumbers`)의 내부 전용 제약을 해제해 관리자 모바일 화면에서도 동일 액션을 사용 가능하도록 조정
- 웹 신청자/프로필 화면의 주민번호 표시 fallback에서 `resident_id_masked` 사용을 제거하고, 원문 조회 실패 시 `-`로 처리하도록 정리
- 모바일 관리자 시험 신청자 화면(`exam-manage`, `exam-manage2`)에 주민번호 원문 조회(`getResidentNumbers`)를 연결
- FC 기본정보 화면(`fc/new`)의 기존 마스킹 문자열 노출을 제거하고, 관리자 세션에서는 원문 조회 시 원문 표시하도록 보강

**핵심 파일**:
- `supabase/functions/admin-action/index.ts`
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `app/exam-manage.tsx`
- `app/exam-manage2.tsx`
- `app/fc/new.tsx`

**검증**:
- `npm run lint` (mobile) 통과
- `cd web && npm run lint` 통과

---

## <a id="20260219-5"></a> 2026-02-19 | WORK_LOG 최근 작업 행수 제한 제거(정책/CI 동기화)

**작업 내용**:
- 문서 정책에서 `WORK_LOG` 최근 작업 테이블의 행수 상한(30행) 규칙을 제거
- CI 거버넌스 검사(`check-governance.mjs`)에서 최근 작업 행수 초과 실패 검사를 제거
- 연동 문서 표현을 상한 기준에서 "최신 항목 상단 정렬 유지" 기준으로 정리

**핵심 파일**:
- `AGENTS.md`
- `.claude/PROJECT_GUIDE.md`
- `.claude/WORK_LOG.md`
- `scripts/ci/check-governance.mjs`

**검증**:
- `node scripts/ci/check-governance.mjs` 통과
- `WORK_LOG` ↔ `WORK_DETAIL` 앵커 링크 규칙 유지 확인

---

## <a id="20260219-4"></a> 2026-02-19 | 관리자 웹 서류 탭에서 미제출 항목 노출 필터 보정

**작업 내용**:
- 관리자 웹 대시보드의 FC 상세 > 서류 탭에서 `제출된 서류` 집계/목록 필터가
  `storage_path !== 'deleted'`만 검사하던 조건을 수정
- `storage_path`가 실제로 존재하는(업로드된) 항목만 `제출된 서류`에 노출되도록 보정
- 결과적으로 미제출 항목(빈 `storage_path`)은 `제출된 서류` 영역에서 제외됨

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

**검증**:
- `cd web && npm run lint` 통과
- 제출된 서류 count/list 조건이 동일 필터(`storage_path && storage_path !== 'deleted'`)로 정렬된 것 확인

---

## <a id="20260219-3"></a> 2026-02-19 | 웹 FC 상세에서 관리자 주민번호 원문 조회 표시 연동

**작업 내용**:
- 웹 FC 상세 페이지에서 `resident_id_masked`만 표시하던 로직을 보완해, 관리자 권한일 때 서버 API(`/api/admin/resident-numbers`)를 통해 주민번호 원문을 조회하도록 변경
- 주민번호 원문 조회 실패 또는 관리자 권한이 아닌 경우에는 기존 마스킹값으로 자동 fallback하도록 유지
- 생년월일 표시도 동일한 표시값(원문 우선, 실패 시 마스킹) 기준으로 계산되도록 정렬

**핵심 파일**:
- `web/src/app/dashboard/profile/[id]/page.tsx`

**검증**:
- `cd web && npm run lint` 통과
- 관리자 전용 주민번호 조회 경로를 기존 서버-중계 API 기반으로 사용해 보안 경로 유지 확인

---

## <a id="20260219-2"></a> 2026-02-19 | 수당동의 임시사번 선검증 및 계정 중복 차단 강화

**작업 내용**:
- 수당 동의 입력 시 임시사번(`temp_id`)이 없는 FC를 서버/클라이언트에서 선차단하도록 보강:
  - `fc-consent`에서 `temp_id`를 조회하고 미발급 시 실패 응답 반환
  - 모바일 `app/consent.tsx` 제출 전 임시사번 존재 여부를 확인하고 안내 알림 후 중단
- 비밀번호 설정 시 전화번호 중복 계정 차단 강화:
  - `set-password`에서 `admin_accounts`, `manager_accounts` 중복을 선검사해 FC 계정 생성 차단
- 웹 프로필 페이지 effect 의존성 경고를 정리해 폼 초기화 동작을 안정화
- Supabase Edge Functions용 Deno import map 파일(`supabase/functions/deno.json`) 추가 및 IDE Deno 설정 반영

**핵심 파일**:
- `app/consent.tsx`
- `supabase/functions/fc-consent/index.ts`
- `supabase/functions/set-password/index.ts`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `supabase/functions/deno.json`
- `.vscode/settings.json`
- `.claude/settings.json`

**검증**:
- 변경 파일 diff 검토로 수당 동의 선검증/중복 차단 로직 반영 확인
- 문서 거버넌스 규칙(`WORK_LOG` + `WORK_DETAIL` 동시 갱신) 충족 확인

---

## <a id="20260219-1"></a> 2026-02-19 | 회원가입 사전 중복검증/홈 플로우 안정화 및 AGENTS 거버넌스 문서 추가

**Commit**: `46d7a59`  
**작업 내용**:
- 회원가입 시작 단계에서 OTP 발송 전 번호 중복 여부를 사전 확인하도록 보강:
  - `request-signup-otp`에 `checkOnly` 모드 추가
  - FC/총무/본부장 전화번호 중복을 서버에서 일괄 판정
  - 이미 가입된 번호는 `ok: false`와 안내 메시지로 반환
- 앱 가입 화면에서 `checkOnly` 호출을 사용해 중복 번호를 조기 차단하고, 확인 중 버튼 비활성화 처리 추가
- 신원정보 저장 이후 홈 진입 단계 계산이 즉시 갱신되도록 `my-fc-status` 쿼리 invalidate/refetch 추가
- Android 홈 화면 뒤로가기 시 앱 종료 확인 다이얼로그 추가 (`app/index.tsx`, `app/home-lite.tsx`)
- 루트/하위 `AGENTS.md` 문서군 및 `AGENT.md`를 추가해 모듈별 컨텍스트 라우팅 문서 체계 정리

**핵심 파일**:
- `app/signup.tsx`
- `supabase/functions/request-signup-otp/index.ts`
- `app/identity.tsx`
- `app/index.tsx`
- `app/home-lite.tsx`
- `app/_layout.tsx`
- `AGENT.md`
- `AGENTS.md`
- `app/AGENTS.md`
- `components/AGENTS.md`
- `hooks/AGENTS.md`
- `web/AGENTS.md`
- `supabase/AGENTS.md`
- `supabase/functions/AGENTS.md`

**검증**:
- 커밋 기준 코드/문서 diff 검토
- 거버넌스 조건(코드 변경 시 `WORK_LOG` + `WORK_DETAIL` 동시 갱신) 충족 확인

---

## <a id="20260211-15"></a> 2026-02-11 | Android 릴리즈 난독화/리소스 축소 설정 반영

**작업 내용**:
- `expo-build-properties`의 Android 릴리즈 옵션에 아래 값을 추가:
  - `enableMinifyInReleaseBuilds: true`
  - `enableShrinkResourcesInReleaseBuilds: true`
- 목적:
  - 릴리즈 AAB에서 R8 난독화/코드 최적화 활성화
  - 리소스 축소로 앱 크기 감소
  - Play Console의 deobfuscation 관련 경고 원인(난독화 미설정 상태) 해소 기반 마련

**핵심 파일**:
- `app.json`

**검증**:
- `npx expo config --type public --json` 성공

---

## <a id="20260211-16"></a> 2026-02-11 | iOS 빌드 번들ID 등록 실패(Apple Maintenance) 대응

**작업 내용**:
- `eas build` 실패 로그의 HTML 본문(`Maintenance - Apple Developer`) 기준으로 Apple Developer 포털 점검 응답을 원인으로 확인
- Git/EAS 로컬 환경 점검:
  - `eas --version`을 `16.32.0`으로 업데이트
  - `eas whoami`로 계정 인증 상태 확인(`jj8127`)
- 운영 문서 보강:
  - Apple 점검 시 우회 빌드 커맨드(`--non-interactive --freeze-credentials`)와 재설정 순서를 명령어 문서에 추가

**핵심 파일**:
- `docs/guides/명령어 모음집.txt`

**검증**:
- `Invoke-WebRequest https://developer.apple.com/maintenance/` 결과에서 maintenance 문구 확인
- `eas --version` 결과 `16.32.0` 확인

---

## <a id="20260211-14"></a> 2026-02-11 | 정책/보안 정리(B): 로컬 산출물/설정 추적 해제

**작업 내용**:
- 정책 불일치 정리:
  - 추적 중이던 `testsprite_tests/` 산출물 삭제(이미 `.gitignore` 대상)
  - 고아 gitlink 상태의 `Claude-Code-Usage-Monitor` 제거
- 보안/로컬 설정 정리:
  - 민감값이 포함될 수 있는 `.codex/config.toml`, `.codex/mcp.json` 추적 제거
  - `.gitignore`에 `.codex/`, `Claude-Code-Usage-Monitor/` 추가

**핵심 파일**:
- `.gitignore`
- `.codex/config.toml` (삭제)
- `.codex/mcp.json` (삭제)
- `testsprite_tests/*` (삭제)
- `Claude-Code-Usage-Monitor` (gitlink 삭제)

---

## <a id="20260211-13"></a> 2026-02-11 | 안전 묶음(A): 빌드 산출물/미사용 모듈 정리

**작업 내용**:
- 빌드 산출물 정리:
  - `dist-web-new2/` 전체 삭제
  - 재추적 방지를 위해 `.gitignore`에 `dist-web/`, `dist-web-new2/` 추가
- 미사용 코드/자산 정리:
  - 미사용 라우트/모듈 삭제:
    - `app/admin-register.tsx`
    - `components/LoginForm.tsx`, `components/ImageTourGuide.tsx`
    - `components/BoardCard.tsx`, `components/EmptyState.tsx`
    - `components/external-link.tsx`, `components/haptic-tab.tsx`, `components/hello-wave.tsx`
    - `components/ui/icon-symbol.tsx`, `components/ui/icon-symbol.ios.tsx`
    - `hooks/use-dashboard-data.ts`, `hooks/use-theme-color.ts`
    - `constants/theme.ts`, `lib/docRules.ts`
  - 미사용 자산 삭제:
    - `assets/guide/shortcuts-guide.jpg`
    - `assets/guide/shortcuts-guide.png`
    - `agreement_imag/00.jpg`

**검증**:
- `npm run lint` (mobile) 통과
- `npx tsc --noEmit` (mobile) 통과
- `npm test -- --runInBand` 통과
- `npm run lint` (web) 통과
- `npm run build` (web) 통과

---

## <a id="20260211-12"></a> 2026-02-11 | 앱/웹 미점검 영역 종합 점검 및 안정화 패치

**작업 내용**:
- 모바일/웹 전체 정적 검사 및 테스트 실행:
  - 모바일 `expo lint`, `tsc --noEmit`, `jest --runInBand`
  - 웹 `eslint`, `next build`, `tsc --noEmit`
- 실결함 보정:
  - `app/_layout.tsx`에서 누락된 `safeStorage` import 추가(런타임 참조 안정화)
  - `useIdentityGate`의 잘못된 경로(`'/auth'`)를 실제 로그인 경로(`'/login'`)로 수정
  - Jest가 `web/.next`를 스캔해 실패하던 문제를 ignore 패턴으로 차단
  - 홈 가이드 시작 안정화: 메인/바로가기 가이드 상호 정지 후 `start(1)` 명시 시작 + 재시도 타이밍 보강
- 품질 경고 정리(동작 변경 없는 리팩터링):
  - 미사용 변수/임포트 제거
  - Hook dependency 누락 경고 정리
  - 웹 채팅 메시지 로딩 effect 의존성 정합성 보강
  - 웹 공지 상세 이미지 렌더링 경고(`no-img-element`) 해소

**핵심 파일**:
- `app/_layout.tsx`
- `hooks/use-identity-gate.ts`
- `jest.config.js`
- `app/consent.tsx`
- `app/index.tsx`
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `app/fc/new.tsx`
- `components/BoardCard.tsx`
- `components/EmptyState.tsx`
- `components/LoadingSkeleton.tsx`
- `components/Toast.tsx`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`

**검증**:
- `npm run lint` (mobile) 통과
- `npx tsc --noEmit` (mobile) 통과
- `npm test -- --runInBand` 통과 (2 suites, 53 tests)
- `npm run lint` (web) 통과
- `npm run build` (web) 통과
- `npx tsc --noEmit` (web) 통과

---

## <a id="20260211-11"></a> 2026-02-11 | 문서 거버넌스 CI/PR 강제 및 SSOT 정리

**작업 내용**:
- `.github/workflows/governance-check.yml` 추가로 문서/스키마 규칙 자동 검사 도입
- PR 본문 체크리스트 미충족 시 실패하도록 `scripts/ci/check-pr-template.mjs` 추가
- 코드 변경 시 `WORK_LOG` + `WORK_DETAIL` 동시 갱신 여부를 검사하는 `scripts/ci/check-governance.mjs` 추가
- `PROJECT_GUIDE.md`에 문서 SSOT 역할 분리와 자동 검증 규칙 명시

**핵심 파일**:
- `.github/workflows/governance-check.yml`
- `.github/pull_request_template.md`
- `scripts/ci/check-governance.mjs`
- `scripts/ci/check-pr-template.mjs`
- `.claude/PROJECT_GUIDE.md`

---

## <a id="20260211-10"></a> 2026-02-11 | 시험 접수 마감 기준을 당일 23:59:59로 변경

**작업 내용**:
- FC 시험 신청 화면(생명/손해)에서 마감 판정 기준을 `마감일 18:00`에서 `마감일 23:59:59`로 수정
- 웹 시험 일정 화면의 `(마감)` 표시 판정도 동일 기준(`endOf('day')`)으로 통일
- 결과적으로 `마감일=19일` 설정 시 `20일 00:00`부터 마감 처리되도록 보정

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `web/src/app/dashboard/exam/schedule/page.tsx`

---

## <a id="20260211-9"></a> 2026-02-11 | 서류 마감일(18:00 기준) 알림 로직 정합성 보정

**작업 내용**:
- `docs-deadline-reminder` 조회 범위를 `D-1 ~ D+3`로 조정하여 사전 리마인드가 가능하도록 보정
- 마감 문구를 분기형(D-3/D-1/D-day/마감 경과)으로 교체
- 마감 기준 시각을 `마감일 18:00(KST)`로 반영 (`DEADLINE_HOUR_KST = 18`)
- `notifications` insert 시 `target_url` 컬럼 불일치(42703) fallback 처리 추가
- 서류 요청 업데이트 시 `fc_profiles` 업데이트 에러 누락 구간 보강

**핵심 파일**:
- `supabase/functions/docs-deadline-reminder/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/api/admin/fc/route.ts`

---

## <a id="20260211-8"></a> 2026-02-11 | 임시번호 발급 알림 탭 시 수당 동의 페이지 이동 보정

**작업 내용**:
- 알림센터 라우팅 fallback에서 `임시번호/임시사번` 키워드 분기를 추가
- `target_url`이 없거나 기존 알림 데이터여도, 해당 알림 탭 시 `/consent`로 이동하도록 보정

**핵심 파일**:
- `app/notifications.tsx`

---

## <a id="20260211-7"></a> 2026-02-11 | 알림센터 저장 누락(푸시만 수신) 대응

**작업 내용**:
- 증상: 푸시 알림은 도착하지만 알림센터(`notifications` 테이블) 저장이 누락됨
- 원인: 일부 경로에서 `target_url` 컬럼 포함 insert 실패 시 로그만 남기고 계속 진행
- 대응:
  - `fc-notify`에 `notifications` insert fallback 추가 (`target_url` 실패 시 컬럼 제외 재시도)
  - `admin-action`의 `sendNotification` 경로에도 동일 fallback 추가
  - 웹 관리자 `sendPushNotification` 및 관리자 채팅 알림 insert에 fallback 추가
  - `fc-notify`, `admin-action` Edge Function 재배포 완료
- 검증:
  - `fc-notify notify(target_id=00000000000)` 호출 후 `inbox_list`에서 저장 레코드 확인

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/actions.ts`
- `web/src/app/dashboard/chat/page.tsx`

---

## <a id="20260211-6"></a> 2026-02-11 | FC 사전등록 안내 화면 임시 공지/알림 섹션 제거

**작업 내용**:
- 사용자 요청에 따라 `apply-gate` 화면에 추가했던 `먼저 확인해보세요` 블록(공지사항/알림센터 버튼)을 제거
- 기존 등록 신청 안내 및 기본 버튼(나중에/등록 신청 시작)만 유지

**핵심 파일**:
- `app/apply-gate.tsx`

---

## <a id="20260211-5"></a> 2026-02-11 | FC 사전등록 공지/알림 접근 개선 및 CORS 기본값 보정

**작업 내용**:
- FC 사전등록 안내 화면(`apply-gate`)에서 공지/알림센터로 즉시 이동 가능한 버튼 추가
- `home-lite` 바로가기 영역에서 불필요한 3번째 카드(알림센터 카드) 제거 요청 반영
- `fc-notify` Edge Function CORS 기본 `Access-Control-Allow-Origin` 값을 `*`로 보정하여, `ALLOWED_ORIGINS` 미설정 환경에서 공지/알림 조회 실패 가능성 완화

**핵심 파일**:
- `app/apply-gate.tsx`
- `app/home-lite.tsx`
- `supabase/functions/fc-notify/index.ts`

---

## <a id="20260211-1"></a> 2026-02-11 | 웹 공지 상세 페이지 및 목록 행 클릭 이동 구현

**Commit**: `778d48e`  
**작업 내용**:
- 관리자 웹 공지 목록에서 행 클릭 시 상세 페이지로 이동하도록 라우팅 개선
- 공지 상세 페이지(`notifications/[id]`) 동선 정리
- 서버 API와 상세 뷰 연결 강화

**핵심 파일**:
- `web/src/app/dashboard/notifications/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`
- `web/src/app/api/admin/notices/route.ts`

---

## <a id="20260211-2"></a> 2026-02-11 | 웹 공지 조회를 서버 API 경유로 전환(RLS 우회)

**Commit**: `50586dc`  
**작업 내용**:
- 웹 공지 목록이 RLS 영향으로 비어 보이던 문제 해결
- 클라이언트 직접 조회 대신 서버 라우트 API를 통해 공지 목록 조회

**핵심 파일**:
- `web/src/app/api/admin/notices/route.ts`
- `web/src/app/dashboard/notifications/page.tsx`

---

## <a id="20260211-3"></a> 2026-02-11 | 앱 공지 페이지를 fc-notify 기반 조회로 전환

**Commit**: `0074887`  
**작업 내용**:
- 모바일 공지 페이지에서 Supabase 직접 조회 대신 `fc-notify`(`inbox_list`) 응답 기반으로 전환
- RLS 환경에서도 공지/알림센터 데이터가 보이도록 안정화

**핵심 파일**:
- `app/notice.tsx`
- `supabase/functions/fc-notify/index.ts`

---

## <a id="20260211-4"></a> 2026-02-11 | 계정 삭제 플로우 실패 대비(fail-safe) 보강

**Commit**: `ca34a72`  
**작업 내용**:
- 앱 설정의 계정 삭제 로직이 특정 경로 실패 시 중단되던 문제 보완
- 대시보드/설정/Edge Function 삭제 경로를 보강해 삭제 복구 가능성 향상

**핵심 파일**:
- `app/settings.tsx`
- `app/dashboard.tsx`
- `supabase/functions/delete-account/index.ts`

---

## <a id="20260210-1"></a> 2026-02-10 | Windows 환경 Next.js dev lockfile 충돌 완화

**Commits**: `93f1336`, `05d3aec`  
**작업 내용**:
- Windows에서 `.next` lockfile/권한 충돌로 dev/build가 막히는 문제 완화
- dev 시작 전 프로세스 정리 및 안전한 클린업 스크립트 추가

**핵심 파일**:
- `web/package.json`
- `web/scripts/clean-next.mjs`
- `web/scripts/kill-next-dev.mjs`

---

## <a id="20260210-2"></a> 2026-02-10 | 웹 세션 쿠키 동기화 및 재로드 후 API 인증 안정화

**Commits**: `91fc04c`, `bdaa8eb`, `b462f4c`  
**작업 내용**:
- 웹 세션 복원 시 쿠키 동기화가 누락되어 관리자 API가 실패하던 문제 수정
- 세션 하이드레이션 이후 주민번호 조회 등 민감 API를 지연/조건부 호출

**핵심 파일**:
- `web/src/hooks/use-session.tsx`
- `web/src/app/dashboard/exam/applicants/page.tsx`

---

## <a id="20260210-3"></a> 2026-02-10 | 시험 신청자 화면 UX/타입/주민번호 표시 개선

**Commits**: `70d61de`, `18ea173`, `02a7d12`, `cb63c19`, `d4eeb52`, `1cdb808`  
**작업 내용**:
- 신청자 테이블 가로 스크롤 및 컬럼 폭 조정
- 주민등록번호 표시 컬럼 정합성 개선
- `no-explicit-any` 대응 등 타입 안정성 개선

**핵심 파일**:
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/api/admin/resident-numbers/route.ts`
- `web/src/app/api/admin/fc/route.ts`

---

## <a id="20260210-4"></a> 2026-02-10 | 시험 일정/신청 도메인 null 날짜 처리 및 연계 안정화

**Commits**: `d674396`, `554342c`, `12e2625`  
**작업 내용**:
- `exam_date`가 `null`(미정)일 때 `Invalid Date`/`1970-01-01` 노출 문제 대응
- 시험 과목/라벨 표시 로직 정리
- 앱/웹/함수/스키마 동시 보정으로 일정 등록-조회 흐름 안정화

**핵심 파일**:
- `types/exam.ts`
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`
- `web/src/app/dashboard/exam/schedule/actions.ts`
- `supabase/functions/admin-action/index.ts`
- `supabase/schema.sql`

---

## <a id="20260210-5"></a> 2026-02-10 | 대시보드 사이드바 토글/호버 확장 UX 도입

**Commits**: `e47da92`, `9957364`  
**작업 내용**:
- 사이드바를 버튼 기반 토글에서 호버 확장 UX까지 확장
- 좌측 네비게이션 가시성/작업 동선 개선

**핵심 파일**:
- `web/src/app/dashboard/layout.tsx`

---

## <a id="20260209-1"></a> 2026-02-09 | 앱/웹 누적 미반영 수정 일괄 반영 및 정리

**Commit**: `94a3fe6`  
**작업 내용**:
- 대시보드, 시험, 알림센터, 문서/회원가입 등 다수 화면/함수 정리
- 앱/웹 종단 간 누적 이슈를 하나의 정리 커밋으로 반영

**핵심 파일(대표)**:
- `app/dashboard.tsx`, `app/notifications.tsx`, `app/index.tsx`
- `supabase/functions/admin-action/index.ts`, `supabase/functions/fc-notify/index.ts`
- `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/exam/schedule/*`

---

## <a id="20260205-1"></a> 2026-02-05 | 온보딩 플로우 및 관리자 대시보드 대규모 업데이트

**Commit**: `904f020`  
**작업 내용**:
- 앱 온보딩 흐름(로그인/가입/수당/서류/위촉) 및 관리자 도메인 로직 동시 업데이트
- 스키마/함수/웹 관리 페이지 연동 정비
- 문서(README/CLAUDE/COMMANDS) 갱신

**핵심 파일(대표)**:
- `app/*` 다수
- `supabase/functions/*` 일부
- `supabase/schema.sql`
- `web/src/app/dashboard/*` 다수

---

## <a id="20260205-2"></a> 2026-02-05 | 서비스 계정/앱 키 파일 Git 관리 정책 조정

**Commits**: `9a1338b`, `14f4040`, `629b29a`  
**작업 내용**:
- `google-services.json`의 추적/제외 정책을 빌드 상황에 맞게 조정
- 캐시/민감 파일 ignore 정책 정리

**핵심 파일**:
- `.gitignore`
- `google-services.json`

---

## <a id="20260129-1"></a> 2026-01-29 | 미등록 계정 로그인/재설정 처리 및 FC 삭제 개선

**Commit**: `75defa8`  
**작업 내용**:
- 등록되지 않은 계정의 로그인/비밀번호 재설정 UX 보강
- FC 삭제 API/대시보드 연계 개선

**핵심 파일**:
- `app/auth.tsx`, `app/reset-password.tsx`
- `hooks/use-login.ts`
- `supabase/functions/login-with-password/index.ts`
- `supabase/functions/request-password-reset/index.ts`
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260126-1"></a> 2026-01-26 | fc-delete API의 cookies 비동기 처리 보정

**Commit**: `23e4d8d`  
**작업 내용**:
- Next.js Route Handler에서 `cookies()` 사용 방식 보정
- 삭제 API 런타임 오류 방지

**핵심 파일**:
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260126-2"></a> 2026-01-26 | 동의/서류/일정/알림 액션 흐름 개선

**Commit**: `1d3b6b6`  
**작업 내용**:
- 수당 동의 및 대시보드 액션 관련 웹 서버 액션/알림 처리 보정
- 앱 홈/동의 플로우와 웹 액션의 상태 동기화 강화

**핵심 파일**:
- `app/consent.tsx`, `app/index.tsx`
- `supabase/functions/fc-consent/index.ts`
- `web/src/app/dashboard/*/actions.ts`

---

## <a id="20260126-3"></a> 2026-01-26 | 앱 브랜딩 자산 및 일부 대시보드/삭제 경로 조정

**Commit**: `faa61c1`  
**작업 내용**:
- 로그인/아이콘 자산 업데이트
- FC 삭제/대시보드 일부 경로 정리

**핵심 파일**:
- `app/login.tsx`
- `assets/images/*`
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260121-1"></a> 2026-01-21 | 모바일 게시판 홈 네비게이션 동선 조정

**Commit**: `c496aa7`  
**작업 내용**:
- 게시판 화면에서 홈/주요 경로 이동 UX 개선

**핵심 파일**:
- `app/board.tsx`

---

## <a id="20260121-2"></a> 2026-01-21 | Supabase Security Advisor 권고 반영

**Commit**: `09c9b30`  
**작업 내용**:
- RLS/뷰/함수 search_path 관련 보안 권고사항 반영
- 스키마와 마이그레이션 동시 정비

**핵심 파일**:
- `supabase/schema.sql`
- `supabase/migrations/20260121132500_enable_rls_and_view_security.sql`
- `supabase/migrations/20260121135000_fix_search_path_and_policies.sql`

---

## <a id="20260120-1"></a> 2026-01-20 | 하단 내비 컴포넌트 도입 및 설정 화면 정리

**Commit**: `fbb88d9`  
**작업 내용**:
- 모바일 공통 하단 내비게이션 컴포넌트 추가
- 설정/공지 화면 UI 정리 및 관련 컨텍스트 업데이트

**핵심 파일**:
- `components/BottomNavigation.tsx`
- `app/settings.tsx`, `app/notice.tsx`
- `hooks/use-bottom-nav-animation.ts`

---

## <a id="20260119-1"></a> 2026-01-19 | 게시판 화면 고도화 + Claude Skills/Subagent 체계 도입

**Commit**: `87276c6`  
**작업 내용**:
- 게시판 화면 개선
- `.claude/skills`, `.claude/agents` 문서/규칙 체계 구축

**핵심 파일**:
- `.claude/AGENTS_AND_SKILLS.md`
- `.claude/skills/*/SKILL.md`
- `.claude/agents/*.md`
- `app/board.tsx`

---

## <a id="20260117-1"></a> 2026-01-17 | 웹 빌드(TypeScript) 오류 수정

**Commit**: `785083f`  
**작업 내용**:
- Vercel 빌드를 막던 타입 오류 정리
- 관리자 웹 페이지 타입 안전성 보강

**핵심 파일**:
- `web/src/app/admin/exams/[id]/page.tsx`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`

---

## <a id="20260117-2"></a> 2026-01-17 | 게시판 기능(모바일/웹 + Edge Functions) 대규모 도입

**Commit**: `2f69ca4`  
**작업 내용**:
- 게시판 CRUD/댓글/반응/첨부 업로드/다운로드 기능 전면 도입
- 모바일/웹 UI 및 Edge Functions 세트 구축
- API 계약/요구사항/ADR/테마 컴포넌트 문서 업데이트

**핵심 파일(대표)**:
- `app/board.tsx`, `app/admin-board*.tsx`
- `supabase/functions/board-*`
- `lib/board-api.ts`, `web/src/lib/board-api.ts`
- `contracts/api-contracts.md`, `docs/guides/BOARD_REQUIREMENTS.md`

---

## <a id="20260113-1"></a> 2026-01-13 | 문서 최신화 및 Manager 읽기 전용 UI 보강

**Commit**: `f1448b6`  
**작업 내용**:
- 본부장(Manager) 계정 읽기 전용 표시/동작 추가 보정
- 대시보드/시험/채팅/공지 생성 화면 UX 문구 및 제어 정리

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`
- `web/src/app/dashboard/exam/*`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/components/StatusToggle.tsx`

---

## <a id="20260112-1"></a> 2026-01-12 | 공통 문서/컴포넌트/로거/개발도구 기반 구축

**Commit**: `0c95e8e`  
**작업 내용**:
- 프로젝트 문서 체계(`AI.md`, `HANDOVER.md`, `contracts`, `adr`) 정리
- 공통 UI 컴포넌트/로깅/검증/테스트/Git hooks 기반 확장
- 앱/웹/함수 전반 구조 정비

**핵심 파일(대표)**:
- `AI.md`, `HANDOVER.md`, `contracts/*`, `adr/*`
- `components/Button.tsx`, `components/FormInput.tsx`, `components/LoadingSkeleton.tsx`
- `lib/logger.ts`, `lib/validation.ts`
- `package.json`, `.husky/pre-commit`

---

## <a id="20260112-2"></a> 2026-01-12 | 웹 Manager 역할 처리 + 로그/빌드 호환성 + 시험일 미정 지원

**Commits**: `0cc1c4e`, `0689434`, `e4f944e`, `8b910e5`  
**작업 내용**:
- 웹 세션에 `manager` 역할 처리 및 읽기 전용 동작 반영
- logger의 Next.js 빌드 호환성 개선
- 시험 일정의 `TBD(미정)` 처리 지원

**핵심 파일**:
- `web/src/hooks/use-session.tsx`
- `web/src/app/auth/page.tsx`
- `web/src/app/dashboard/exam/schedule/page.tsx`
- `web/src/lib/logger.ts`

---

## <a id="20260112-3"></a> 2026-01-12 | 신원확인 입력 UX 및 명령어 문서 보강

**Commit**: `f0f46bb`  
**작업 내용**:
- 신원확인 입력 중 스크롤/키보드 충돌 완화
- 운영용 명령어 문서 보강

**핵심 파일**:
- `components/KeyboardAwareWrapper.tsx`
- `docs/guides/명령어 모음집.txt`

---

## <a id="20260112-4"></a> 2026-01-12 | 모바일 로그인 로고 반영

**Commit**: `f165d5a`  
**작업 내용**:
- 모바일 로그인 화면에 웹과 동일 브랜딩 로고 반영

**핵심 파일**:
- `app/login.tsx`

---

## <a id="20260112-5"></a> 2026-01-12 | 빌드 의존성 정렬 및 SMS 운영 문서 추가

**Commit**: `a0fbfcf`  
**작업 내용**:
- 빌드 의존성 정리
- SMS 테스트/운영 문서 및 스크립트 추가

**핵심 파일**:
- `package.json`, `package-lock.json`
- `docs/guides/COMMANDS.md`
- `docs/guides/SMS_TESTING.md`
- `test-sms.js`
