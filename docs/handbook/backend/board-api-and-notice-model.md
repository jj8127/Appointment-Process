doc_id: FC-BACKEND-BOARD-NOTICE
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-08-10
source_of_truth: supabase/functions/board-* + web/src/app/api/admin/notices/route.ts

contract_guard_2026_07_03: mobile board/notice screens, admin board/notification pages, board Edge Functions, notice API routes, notification route normalization, and automated digest posting are mapped in docs/handbook/contract-test-map.json.

# Backend Runbook: Board API And Notice Model

## 2026-08-10 Reply commit and visibility contract

- Mobile and admin-web composers retain the entered content and selected reply target until `board-comment-create` succeeds. A failed request must remain retryable as the same reply and must not silently become a top-level comment.
- Reply UI state carries both the exact parent comment ID and the root thread ID. Only the parent ID is sent to the Edge Function; the root ID is client-local state used to reveal the committed reply.
- On success, callers clear only the reply target that belonged to the completed request, expand its root thread, and refresh board detail/list queries. A newer reply target selected during an in-flight request must not be cleared by the older completion.
- Default thread collapse is initialized once per opened post. An empty collapsed-thread list after initialization means the user intentionally expanded every thread and must not trigger automatic re-collapse.
- `board-comment-create` reloads the selected parent, verifies that it belongs to the same post, enforces the supported reply depth, and persists that exact ID as `board_comments.parent_id`.

## 2026-07-25 Notification-only retry contract

- `board-create` and `board-update` return `delivery.notificationStored`. Only inbox persistence failure returns `notificationRetry: { postId, eventKey }`. `board-create` also persists one bounded `notification_delivery_attempts` audit row per fanout target and returns a delivery warning when inbox persistence, provider confirmation, or the audit write is unconfirmed; it never returns provider bodies or recipient data.
- Mobile and web retry only `board-notification-retry` with that pair. They never resubmit the create/update mutation, so a delivery retry cannot duplicate a post or repeat an edit.
- The retry Edge accepts a signed app session for an active `admin` or `manager`. An admin may retry any committed board post; a manager may retry only a manager-authored post owned by the same canonical resident ID. Board automation and FC sessions are not authorized.
- The server reloads the committed post, re-derives the event key from `postId + updated_at`, and derives the fixed `fc`, `admin`, and `manager` broadcast rows itself. Caller-supplied recipient roles, resident IDs, notification content, and targets are never accepted.
- Each domain event and recipient role has one `notifications.delivery_key`. A non-partial unique index plus `upsert(... onConflict: 'delivery_key')` makes repeated retry requests return the canonical rows instead of duplicating inbox entries.
- Inbox rows are verified for UUID, exact role, null exact-recipient fields, typed `board_post` target, and exact delivery key before `fc-notify` is called in provider-only mode.
- Rollout order is migration first, then `fc-notify`, `board-create`, `board-update`, and `board-notification-retry`, followed by mobile/web clients. Runtime secrets are the existing app-session signing configuration plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no new secret is introduced.

## 2026-07-23 Post-write notification delivery contract

- `board-create` and `board-update` keep a committed board mutation successful even when the follow-up notification fanout is partially or fully rejected.
- `board-create` treats an unconfirmed push or failed delivery-attempt audit as a notification warning while preserving `saved=true`. The warning must not invite resubmission of the already committed post.
- The Edge response separates the saved result from a bounded `notification` delivery summary and a user-safe warning; raw provider payloads and recipient details are never returned.
- Each nested `fc-notify` call has a 10-second deadline. A timeout is reported as incomplete notification delivery and never changes the already committed board write into a retryable write failure.
- Push confirmation requires a logged inbox result and matching non-zero `attempted/accepted/sent` counts with zero rejected tickets. A partial Expo ticket result is not a confirmed fanout.
- Mobile and admin-web callers surface the warning only after attachment finalization has completed, so retrying a notification failure cannot duplicate a saved post or attachment.

## 소유 범위

- board category/post/comment/reaction/pin APIs
- signed attachment upload/finalize/delete
- notice source merge

## 핵심 포인트

- board API는 Edge Function 중심입니다.
- 공지는 legacy `notices`와 board `notice` category가 공존합니다.
- 기본 board category seed에는 `공지`, `교육 일정`, `일반`, `상품추천`(`garam-pick`), `시책`(`policy`) 5종만 포함됩니다.
- `latest_notice`는 board notice를 우선 사용합니다.
- attachment metadata와 object 삭제 실패가 완전히 같지 않을 수 있습니다.
- category create/update Edge Function은 canonical slug/name/sort order만 허용하며, legacy "four types" 문구를 사용자 노출 에러로 되살리지 않습니다.

## 라우팅 메모

- 모바일 알림함과 홈 notice 진입은 `board_notice:*` 식별자를 notice 전용 상세가 아니라 board post 상세 경험으로 수렴시켜야 합니다.
- 운영 웹의 `/dashboard/chat`도 동일한 notice/thread 컨텍스트를 재사용하므로, board notice 라우팅을 바꿀 때는 모바일 `notice-route`와 함께 검토합니다.

## 2026-04-06 운영 메모

- 일반 게시판 글 작성은 `board-create`가 게시글 저장과 inbox row insert를 담당합니다.
- 일반 게시판 글 수정은 `board-update`가 게시글 수정 후 같은 `/board?postId=...` target으로 inbox row insert와 push fanout을 담당합니다.
- 다만 push/web-push fanout의 SSOT는 계속 `fc-notify`이므로, `board-create`가 직접 `notifications` row를 넣는 경우에도 같은 요청 흐름에서 `fc-notify`를 다시 호출해야 합니다.
- 이때 중복 inbox row를 막기 위해 `fc-notify`에는 `skip_notification_insert=true`를 함께 전달합니다.

## 2026-06-08 카테고리 운영 메모

- `garam-pick`의 표시명은 `상품추천`이며 stable slug는 계속 `garam-pick`입니다.
- `policy`는 `시책` 표시명과 sort order 5를 사용합니다.
- canonical 5종 밖의 legacy category 게시글은 migration에서 `general`로 재배치하고 old category는 inactive 처리합니다.

## 2026-07-13 actor·automation·attachment 계약

- Board Edge Functions derive the actor from `x-app-session-token` plus the canonical active account/profile. A client `actor` object may be checked for mismatch, but it cannot grant a role or identity.
- `x-board-automation-token` is a separate internal boundary. Automation is limited to category list, general-category list, and create; automated list reads require the canonical active `general` category and return only `id,title,created_at` with a fixed limit.
- Managers may mutate only their own manager-authored posts; FC sessions cannot use manager/admin mutation paths. Signed upload and finalize both enforce that ownership.
- Attachment finalize accepts only canonical `board/<postId>/<uuid>_<sanitizedName>` paths, validates metadata and limits against the stored object, and rejects duplicate paths. Post fields and attachment ordering are committed together through `update_board_post_atomic`.

## 2026-07-16 Board diagnostic privacy contract

- Reviewed Board transport/view/database failures use the shared closed Edge diagnostic helper with fixed event/reason values and optional bounded status metadata.
- Board diagnostics must not include actor or post identifiers, target roles, response bodies, parsed upstream messages, raw database/storage errors, URLs, or object paths.
- Push fanout, notification insert, attachment cleanup, and view tracking retain their existing best-effort or fail-closed behavior. A diagnostic failure must not change the existing response, database, storage, or notification behavior.
- The reviewed Board surface has no unproven direct-console sink. Only the two exact missing-configuration literals remain allowlisted; every operational failure uses the closed diagnostic helper, and changes require the privacy source test and AST baseline to be reviewed together.
