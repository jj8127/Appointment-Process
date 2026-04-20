# Product spec

## Task summary
- Ship optimization pass 1 for the Garamin internal messenger and unread badges without changing user-facing routes.
- Move internal chat list/unread aggregation from repeated client queries into `fc-notify`.
- Remove high-frequency polling from chat, messenger hub, and home where realtime/focus/app-active refresh is sufficient.
- Restore missing top-header back navigation on `메신저` and `가람지사 메신저` after QA surfaced the regression.
- Replace bare `ActivityIndicator`-only loading UX across app screens and shared components with the branded animated loading system.

## User outcomes
- 총무/설계 매니저 내부 메신저 목록이 더 적은 쿼리로 빠르게 열린다.
- 채팅방은 2.5초 전체 재조회 없이도 새 메시지/읽음이 갱신된다.
- 홈/메신저 허브의 내부 unread 숫자가 5초 polling 없이 일관되게 보인다.
- `메신저`, `가람지사 메신저` 상단에서 뒤로가기 버튼이 항상 보이고, 스택이 없을 때도 안전한 fallback 경로로 이동한다.
- 메신저/의뢰/시험/홈/입력 저장 버튼 로딩이 더 이상 빈 스피너만 보이지 않고, 같은 브랜드 애니메이션으로 일관되게 보인다.

## Implementation shape
- Add shared internal-chat aggregation helpers under `supabase/functions/_shared/internal-chat.ts`.
- Extend `fc-notify` with:
  - `internal_chat_list`
  - `internal_unread_count`
  - `chat_targets` unread counts per target
- Add typed mobile client helpers in `lib/internal-chat-api.ts`.
- Add reusable loading primitives:
  - `components/BrandedLoadingState.tsx`
  - `components/BrandedLoadingSpinner.tsx`
  - `lib/branded-loading-spinner.ts`
  - `lib/messenger-loading.ts`
- Refactor:
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
  - `app/exam-apply*.tsx`
  - `app/exam-manage*.tsx`
  - `app/appointment.tsx`
  - `app/board-detail.tsx`
  - `app/notice-detail.tsx`
  - `app/hanwha-commission.tsx`
  - `app/login.tsx`
  - `app/docs-upload.tsx`
  - `app/referral.tsx`
  - `components/Button.tsx`
  - `components/ReferralSearchField.tsx`
  - `components/ReferralTreeNode.tsx`
- Deduplicate native badge writes in `lib/system-notification-badge.ts`.
- Add a tested back-navigation helper in `lib/back-navigation.ts` and wire it into `app/_layout.tsx` plus `app/admin-messenger.tsx`.

## Key constraints
- No request_board server conversation-list redesign in this pass.
- No schema migration unless a blocking DB/index issue is confirmed.
- Do not store plaintext QA credentials in repo docs or logs.
- Existing unrelated local changes, especially referral work and `app.json`, remain untouched.

## Verification targets
- `npm test -- --runInBand lib/__tests__/back-navigation.test.ts lib/__tests__/internal-chat.test.ts lib/__tests__/signup-referral.test.ts`
- `npm test -- --runInBand lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npx eslint app/_layout.tsx app/admin-messenger.tsx app/chat.tsx app/messenger.tsx app/index.tsx app/notifications.tsx app/request-board.tsx lib/back-navigation.ts lib/internal-chat-api.ts lib/system-notification-badge.ts lib/__tests__/back-navigation.test.ts`
- `npx eslint app/admin-messenger.tsx app/appointment.tsx app/board-detail.tsx app/chat.tsx app/dashboard.tsx app/docs-upload.tsx app/exam-apply.tsx app/exam-apply2.tsx app/exam-manage.tsx app/exam-manage2.tsx app/hanwha-commission.tsx app/index.tsx app/login.tsx app/notice-detail.tsx app/notifications.tsx app/referral.tsx app/request-board-fc-codes.tsx app/request-board-messenger.tsx app/request-board-requests.tsx app/request-board-review.tsx app/request-board.tsx components/Button.tsx components/BrandedLoadingSpinner.tsx components/BrandedLoadingState.tsx components/MessengerLoadingState.tsx components/ReferralSearchField.tsx components/ReferralTreeNode.tsx lib/branded-loading-spinner.ts lib/messenger-loading.ts lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/fc-notify/index.ts`
- `node scripts/ci/check-governance.mjs`
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud`
- `npx tsc --noEmit --pretty false` (expect only known pre-existing failures outside this loading pass)
