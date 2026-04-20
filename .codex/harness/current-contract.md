# Current contract

## Increment
- Name: Internal messenger optimization pass 1 + header recovery + branded loading rollout + login post-success stabilization
- Goal: reduce internal messenger/list/unread cost without changing route structure, close the top-header back-button regression surfaced in QA, replace bare spinner-only loading UI across the remaining app surfaces, and stabilize the mobile login handoff after backend auth succeeds.

## Exact scope
- Internal messenger aggregation/runtime
  - `supabase/functions/_shared/internal-chat.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `lib/internal-chat-api.ts`
- Mobile screens
  - `app/_layout.tsx`
  - `app/admin-messenger.tsx`
  - `app/chat.tsx`
  - `app/messenger.tsx`
  - `app/index.tsx`
  - `app/notifications.tsx`
  - `app/request-board.tsx`
  - `app/request-board-messenger.tsx`
  - `app/request-board-review.tsx`
  - `app/request-board-requests.tsx`
  - `app/request-board-fc-codes.tsx`
  - `app/appointment.tsx`
  - `app/board-detail.tsx`
  - `app/notice-detail.tsx`
  - `app/docs-upload.tsx`
  - `app/login.tsx`
  - `app/referral.tsx`
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
  - `app/exam-manage.tsx`
  - `app/exam-manage2.tsx`
  - `app/hanwha-commission.tsx`
- Client utilities/tests
  - `lib/back-navigation.ts`
  - `lib/branded-loading-spinner.ts`
  - `lib/push-registration.ts`
  - `lib/session-landing.ts`
  - `lib/system-notification-badge.ts`
  - `lib/messenger-loading.ts`
  - `lib/__tests__/back-navigation.test.ts`
  - `lib/__tests__/branded-loading-spinner.test.ts`
  - `lib/__tests__/internal-chat.test.ts`
  - `lib/__tests__/messenger-loading.test.ts`
  - `lib/__tests__/push-registration.test.ts`
  - `lib/__tests__/session-landing.test.ts`
  - `components/BrandedLoadingState.tsx`
  - `components/BrandedLoadingSpinner.tsx`
  - `components/Button.tsx`
  - `components/__tests__/BrandedLoadingSpinner.contract.test.ts`
  - `components/ReferralSearchField.tsx`
  - `components/ReferralTreeNode.tsx`
  - `hooks/__tests__/use-login.contract.test.ts`
- Documentation/handoff
  - `.claude/MISTAKES.md`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/*`

## Acceptance criteria
- [x] 관리자 메신저 목록은 client-side `1 + 2N` 메시지 조회 대신 `fc-notify` 집계 1회로 구성된다.
- [x] `chat_targets`는 대상별 `unread_count`를 반환하고, 채팅 대상 선택기는 row-scan unread 집계를 제거한다.
- [x] 채팅 화면의 2.5초 polling이 제거되고 `initial load + realtime + app active`로 유지된다.
- [x] 메신저 허브/홈 내부 unread는 server aggregate 기반으로 갱신되고 5초 polling을 사용하지 않는다.
- [x] native badge writes는 unread 값이 바뀔 때만 적용된다.
- [x] `메신저` 상단 헤더는 스택 유무와 관계없이 뒤로가기 버튼을 노출한다.
- [x] `가람지사 메신저` 화면 내부 헤더는 뒤로가기 버튼을 노출하고, direct entry 시 `/messenger`로 fallback 가능하다.
- [x] `app/*`, `components/*`에서 bare `ActivityIndicator` 로딩 surface가 제거되고, 공용 branded loading state/spinner로 대체된다.
- [x] full-screen/section loading은 copy가 있는 animated card를 사용하고, button/input/tree/send/upload loading은 compact animated spinner를 사용한다.
- [x] login pending spinner는 font asset download에 의존하지 않는다.
- [x] login mutation success path는 session state propagation 전에 landing route를 직접 replace하지 않는다.
- [x] push token registration은 같은 session에서 지연·중복방지 키로 제어된다.

## Checks run
- `npm test -- --runInBand lib/__tests__/back-navigation.test.ts`
- `npm test -- --runInBand lib/__tests__/internal-chat.test.ts lib/__tests__/signup-referral.test.ts`
- `npx eslint app/_layout.tsx app/admin-messenger.tsx app/chat.tsx app/messenger.tsx app/index.tsx app/notifications.tsx app/request-board.tsx lib/back-navigation.ts lib/internal-chat-api.ts lib/system-notification-badge.ts lib/__tests__/back-navigation.test.ts`
- `npm test -- --runInBand lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npm test -- --runInBand lib/__tests__/session-landing.test.ts lib/__tests__/push-registration.test.ts hooks/__tests__/use-login.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts components/__tests__/BrandedLoadingSpinner.contract.test.ts`
- `npx eslint app/admin-messenger.tsx app/appointment.tsx app/board-detail.tsx app/chat.tsx app/dashboard.tsx app/docs-upload.tsx app/exam-apply.tsx app/exam-apply2.tsx app/exam-manage.tsx app/exam-manage2.tsx app/hanwha-commission.tsx app/index.tsx app/login.tsx app/notice-detail.tsx app/notifications.tsx app/referral.tsx app/request-board-fc-codes.tsx app/request-board-messenger.tsx app/request-board-requests.tsx app/request-board-review.tsx app/request-board.tsx components/Button.tsx components/BrandedLoadingSpinner.tsx components/BrandedLoadingState.tsx components/MessengerLoadingState.tsx components/ReferralSearchField.tsx components/ReferralTreeNode.tsx lib/branded-loading-spinner.ts lib/messenger-loading.ts lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npx eslint app/login.tsx hooks/use-login.ts hooks/use-session.tsx lib/session-landing.ts lib/push-registration.ts lib/__tests__/session-landing.test.ts lib/__tests__/push-registration.test.ts hooks/__tests__/use-login.contract.test.ts components/BrandedLoadingSpinner.tsx lib/branded-loading-spinner.ts components/__tests__/BrandedLoadingSpinner.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npx tsc --noEmit --pretty false` (known pre-existing failures only: `app/appointment.tsx`, `app/hanwha-commission.tsx`, `app/referral.tsx`, `components/DaumPostcode.tsx`, `hooks/use-my-referral-code.ts`)
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/fc-notify/index.ts`
- `node scripts/ci/check-governance.mjs`
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud`

## Rollback / containment
- If internal unread aggregation regresses, revert `fc-notify` and the paired client helper usage together so list payloads and screen expectations stay aligned.
- If navigation regression reappears, keep `lib/back-navigation.ts`, `app/_layout.tsx`, and `app/admin-messenger.tsx` in sync; do not fix only one of the two messenger entry surfaces.
- `request_board` unread/list behavior remains phase-2 scope; do not mix full conversation-list redesign into this pass.
- If loading treatment needs design tweaks later, keep `components/BrandedLoadingState.tsx`, `components/BrandedLoadingSpinner.tsx`, and `lib/messenger-loading.ts` aligned so the copy/animation contract does not drift by screen.
- If login still regresses after backend auth succeeds, inspect `components/BrandedLoadingSpinner.tsx`, `app/login.tsx`, `hooks/use-login.ts`, `hooks/use-session.tsx`, `lib/session-landing.ts`, and `lib/push-registration.ts` together before touching server auth.
