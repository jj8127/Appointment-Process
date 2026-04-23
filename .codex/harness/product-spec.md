# Product spec

## Task summary
- 본부장(모바일의 read-only admin / 웹의 manager)이 `fc-onboarding-app/web`과 가람in 내부 채팅에서 소속과 무관하게 모든 완료 FC를 볼 수 있게 맞춘다.
- GaramLink(`request_board`)는 이번 범위에서 제외한다.
- 기존 권한 계약은 유지한다. 본부장은 계속 읽기 전용이며, 설계매니저 계정은 내부 FC 목록에서 제외한다.

## User outcomes
- 본부장은 가람in 내부 메신저 목록에서 본인 소속이 아닌 FC도 함께 볼 수 있다.
- 관리자 웹 채팅 화면은 관리자/본부장 모두 전체 완료 FC를 같은 기준으로 보고 선택할 수 있다.
- 총무(admin writable)는 기존 내부 조직 중심 동작을 유지한다.
- GaramLink 화면이나 API는 이번 변경의 영향을 받지 않는다.

## Implementation shape
- 모바일 / Edge Function
  - `supabase/functions/_shared/internal-chat.ts`
    - 참여자 포함 규칙을 공용 helper로 분리한다.
    - `includeAllCompletedFc` 옵션이 켜진 read-only admin 경로에서는 완료된 비-설계매니저 FC 전체를 포함한다.
  - `supabase/functions/fc-notify/index.ts`
    - `internal_chat_list`, `internal_unread_count` 양쪽에 같은 참여자 포함 규칙을 적용한다.
- 관리자 웹
  - `web/src/app/dashboard/chat/page.tsx`
    - 클라이언트가 `fc_profiles`를 직접 읽지 않고 `/api/admin/list`를 사용한다.
    - 전체 완료 FC 목록을 좌측 채팅 대상 리스트의 source of truth로 사용한다.
  - `web/src/lib/admin-chat-targets.ts`
    - 완료 여부, 설계매니저 제외, 전화번호 정규화, 중복 제거, 최근 대화 우선 정렬을 순수 함수로 고정한다.

## Key constraints
- GaramLink / `request_board`는 수정하지 않는다.
- 본부장은 계속 읽기 전용이다. “모든 FC 보기”는 가시성 확대이지 쓰기 권한 확대가 아니다.
- 설계매니저(`설계매니저` 포함 affiliation)는 내부 채팅 대상에서 계속 제외한다.
- 기존 deep-link(`targetId`, `targetName`) 열기 동작은 유지한다.
- 모바일 변경은 실제 앱 반영을 위해 `fc-notify` 배포가 필요하다.

## Verification targets
- `npm test -- --runInBand lib/__tests__/internal-chat.test.ts`
- `node --experimental-strip-types --test E:\\hanhwa\\fc-onboarding-app\\web\\src\\lib\\admin-chat-targets.test.ts`
- `npx eslint --rule "import/no-unresolved: off" supabase/functions/_shared/internal-chat.ts supabase/functions/fc-notify/index.ts lib/__tests__/internal-chat.test.ts`
- `cd E:\\hanhwa\\fc-onboarding-app\\web && npm run lint -- src/app/dashboard/chat/page.tsx src/lib/admin-chat-targets.ts src/lib/admin-chat-targets.test.ts`
- `cd E:\\hanhwa\\fc-onboarding-app\\web && npm run build`
- `cd E:\\hanhwa\\fc-onboarding-app && node scripts/ci/check-governance.mjs`
- `cd E:\\hanhwa\\fc-onboarding-app && supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud`
