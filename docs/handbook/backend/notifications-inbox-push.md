doc_id: FC-BACKEND-NOTIFY-PUSH
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-07-16
source_of_truth: supabase/functions/fc-notify/index.ts + supabase/functions/group-chat/index.ts + supabase/functions/_shared/board.ts + supabase/functions/board-create/index.ts + supabase/functions/board-update/index.ts + lib/fc-notify-client.ts + lib/board-api.ts + lib/notifications.ts + web/src/app/api/fc-notify/route.ts + web/src/app/api/board/route.ts + web/src/lib/fc-notify-proxy-policy.ts + web/src/lib/push-notification-service.ts

## Diagnostic Privacy Notes (2026-07-16)

- Mobile registration diagnostics may retain role, configuration-presence, reuse, success, and fixed failure-reason state. They never include resident identifiers, app-session values, Expo push tokens, or raw invocation errors.
- The Expo API route never interpolates an invalid destination token or forwards an exception message. Provider failure logs contain only fixed reason/status fields, while the existing ignored/ok/error response envelope remains stable.
- Group-chat push/database diagnostics never copy recipient phones, device tokens, filenames, storage paths, DB error text, or Expo response bodies. Provider HTTP status and fixed operation reason remain available for triage.
- The admin-web server push service follows the same rule: start/query/delivery/cleanup logs contain only fixed category, reason, status, booleans, and aggregate counts. It never logs recipient IDs, notification title/body, token values, raw database errors, or Expo response bodies, and failed responses return a stable local message rather than provider text.
- Shared mobile/web loggers sanitize before console and Sentry-adjacent capture. Final Sentry event filtering is defense in depth and must not be treated as protection for an earlier console sink.
- Production push replay and hosted log inspection require an approved rollout environment; local source contracts and Deno checks do not prove delivery.

## Priority Security Notes (2026-07-12)

- The public Next `/api/fc-notify` route has two independent trust boundaries. Browser requests
  require an exact scheme-and-canonical-Host origin match plus a verified signed/active server session;
  Request Board callbacks require `X-Request-Bridge-Token` matching `REQUEST_BOARD_NOTIFY_TOKEN`.
- A server-held service-role key is key custody, not caller authentication. Never restore raw-body
  forwarding or use a JS-readable role/resident value as the authorization actor.
- Browser outbound payloads are rebuilt from the verified session. Managers cannot send messages;
  admin/developer may target verified completed non-designer FCs, and a signed completed FC may
  target only the shared admin conversation.
- Request Board callbacks allow only `type=notify`, `target_role=fc`, an 11-digit target, an internal
  relative URL, and the eight current `request_board_*` lifecycle/message categories. Unknown
  control fields such as `skip_notification_insert` are not forwarded. Complete title/body values
  are redacted before the shared 120/2000-character bounds are applied.
- Browser chat callers omit sender id/name and never insert `notifications` directly. The protected
  route derives canonical sender identity, while the Edge Function is the single notification-row writer.
- Sender `FC_ONBOARDING_NOTIFY_TOKEN` and receiver `REQUEST_BOARD_NOTIFY_TOKEN` must be configured
  with the same high-entropy value before rollout. The sender endpoint must be the exact HTTPS
  `/api/fc-notify` route (HTTP only for localhost development checks); missing or invalid configuration
  fails closed before network I/O.
- The direct `fc-notify` handler now has three explicit ingress modes: `latest_notice` public read,
  exact service `apikey`, or signed `x-app-session-token`. App mode rechecks the active DB actor and
  rebuilds action-specific identity/scope before any service-role side effect. Deploy it only after
  mobile caller adoption and required re-login are verified.
- All 17 `board-*` handlers use the same request-bound app actor. This is required because a Board
  handler that still trusts body actor data can become a confused deputy and call `fc-notify` with its
  own service key. Web Board calls use `/api/board`; mobile calls attach the token in `lib/board-api.ts`.
- Exam apply notification delivery is post-commit best effort. A failed admin/self notification must
  be logged as incomplete delivery and must never turn a saved registration into a visible application
  failure that invites a duplicate retry.

## Priority Security Notes (2026-07-06)

- `device_tokens` is a trusted-server table. Mobile/web clients must not call `.from('device_tokens')`
  directly for register, lookup, fanout, or delete.
- Registration and deletion go through `supabase/functions/device-token-register`; push fanout goes
  through `fc-notify`, web server actions, or another service-role/server-only route.
- `device-token-register` derives `resident_id` and `role` from the signed app session token. Request
  bodies must not supply or override `residentId`/`role`.

# Backend Runbook: Notifications, Inbox, And Push

## 소유 범위

- inbox list/unread/delete
- Expo push
- admin web push callback
- latest notice
- request_board unread merge

## 핵심 계약

- `fc-notify`가 notification persistence와 push fanout의 중심입니다.
- admin web push는 `/api/admin/push`와 subscription registry를 통해 보조됩니다.
- request_board bridge unread는 admin/developer session에서 `requestBoardRole='fc'`일 때 함께 합산될 수 있습니다.
- 설계매니저 가람in 모바일 push/unread는 request_board 관련 알림과 본인에게 직접 온 내부 채팅 알림으로 제한합니다. 게시판, 공지, 시험, FC 온보딩 broadcast는 manager 모바일 토큰으로 fanout하지 않습니다.
- Expo push API는 한 요청에 최대 100개 payload만 허용하므로 `fc-notify`는 mobile push payload를 100개 단위로 chunk 전송합니다.
- 2026-06-03 현재 카카오톡 delivery adapter는 활성 계약이 아니다. `fc-notify`는 inbox row와 app/web push를 유지하되 `notification_deliveries` 같은 별도 Kakao audit table에 쓰지 않는다.
- 사용자-facing 알림 제목/분기 문구는 `보증 보험 동의`, `다위촉` 명칭을 사용한다. 내부 `allowance_*`, `hanwha_*` identifier는 기존 DB 호환 때문에 유지될 수 있다.
- 모바일 푸시 탭, 알림센터 row 탭, admin web push URL은 모두 `lib/notification-route.ts`의 route normalizer를 거쳐야 합니다. 게시판 글 URL은 `/board?postId=...`가 canonical mobile target이며, 이 경로가 게시판 화면의 상세 모달을 엽니다. legacy `/board-detail?postId=...` 및 admin web `/dashboard/board?postId=...`는 같은 모달 진입점으로 정규화합니다.

## 2026-03-28 기준 주의점

- 웹 총무/관리자 경로가 `notifications` row를 직접 insert한 뒤 `sendPushNotification()`을 호출할 때는 helper가 다시 row를 만들지 않도록 `skipNotificationInsert`를 사용합니다.
- FC 제출 알림(`fc_update`)의 수신자는 `admin_accounts`와 `manager_accounts`를 함께 해석하고, 실제 device token fanout도 `admin`뿐 아니라 `manager` role을 같이 포함해야 합니다.
- 모바일 홈 unread badge는 checkpoint가 없을 때 `0`으로 초기화하지 않고, 알림센터를 한 번도 열지 않은 사용자에게는 전체 unread를 보여줍니다.

## 2026-04-06 게시판 알림 메모

- 일반 게시판 글 작성은 `board-create`가 inbox row를 직접 저장하는 예외 경로입니다.
- 일반 게시판 글 수정은 `board-update`가 같은 board post target URL로 inbox row와 `fc-notify` push fanout을 함께 보냅니다.
- 이 경로는 row 저장만으로 끝내면 가람in/app/web push가 빠지므로, 같은 change set에서 반드시 `fc-notify` fanout을 함께 호출해야 합니다.
- direct row insert 이후 `fc-notify`를 다시 부를 때는 `skip_notification_insert=true`를 사용해 중복 알림 row를 만들지 않습니다.
- 게시판 글 fanout은 최소 두 축이 필요합니다.
  - `target_role='fc'`: FC 앱 푸시
  - `target_role='admin'`: admin/manager 앱 푸시 + admin web push callback
- 2026-06-16 기준, push data 또는 inbox row에 web/admin URL 형태(`/dashboard/board?postId=...`)나 legacy mobile URL(`/board-detail?postId=...`)이 들어와도 모바일은 `lib/notification-route.ts`에서 `/board?postId=...`로 변환해야 합니다. `app/_layout.tsx`에서 raw `content.data.url`을 직접 `router.push()`하지 않습니다.

## 2026-06-05 Codex 보험 브리핑 메모

- Codex 자동 보험소식 브리핑은 `scripts/ops/post-insurance-digest.mjs`를 통해 게시합니다.
- 스크립트는 게시판 고정 4종 중 `일반`(`general`) 카테고리를 확인/생성한 뒤 기존 `board-create` Edge Function으로 게시합니다.
- 따라서 자동 브리핑도 일반 게시글과 같은 inbox row 저장 및 `fc-notify` fanout 경로를 사용해야 하며, `board_posts` 직접 insert로 우회하지 않습니다.
- 같은 KST 날짜의 `보험소식 브리핑 YYYY.MM.DD` 제목이 이미 있으면 스크립트가 게시를 건너뜁니다.
- 홈 최신 공지(`latest_notice`)는 게시판 `공지`와 `가람pick` 카테고리 글만 포함합니다. 자동 보험 브리핑은 `일반` 게시글이므로 홈 최신 공지 후보로 취급하지 않습니다.
- 자동 브리핑 본문에는 긴 원문 URL이나 AI 참고용/비자문 disclaimer를 넣지 않고, 짧은 출처명만 노출합니다.

## 2026-03-30 정합성 메모

- `fc-notify`의 FC 제출 알림(`fc_update`, `fc_delete`)은 수신자 해석 시 `admin_accounts`, `manager_accounts`, `affiliation_manager_mappings`를 함께 참조합니다.
- 모바일 푸시 fanout도 `device_tokens.role in ('admin', 'manager')`를 포함해 총무 기기까지 도달해야 합니다.
- `recipient_role`은 inbox 조회 계약을 유지하기 위해 저장 시 여전히 `admin` 또는 `fc` 축을 사용하지만, 실제 fanout 대상은 이와 별개로 확장될 수 있습니다.
- 앱 unread 집계는 checkpoint가 없을 때 전체 unread를 기준으로 시작하고, 알림센터 진입 후부터 checkpoint 기반 증분 unread로 전환됩니다.

## 운영 실수

- web push identity row를 권한 원천으로 오해하지 않음
- badge 숫자와 앱 unread는 동기화 주기가 다를 수 있음
- bridge notification이 앱 한쪽에만 보이면 request_board fanout부터 추적

## 2026-05-30 unread characterization 메모

- 모바일 unread 집계는 checkpoint 기반 fc-onboarding unread와 live request_board unread를 분리해 계산한다.
- checkpoint key는 `role + residentId + requestBoardRole` scope를 유지해야 하며, request_board FC/designer bridge 사용자가 같은 checkpoint를 공유하면 회귀다.
- live request_board unread를 포함하는 경우에만 `fc-notify` body의 request_board category 제외 플래그도 같이 유지한다.
- polling/orchestration 경로는 checkpoint를 새로 초기화하지 않고, request_board unread fetch 실패 시 `[mobile-unread-count] fetch failed`를 남긴 뒤 `0` fallback을 유지한다.

## 2026-06-05 설계매니저 모바일 알림 제한 메모

- request_board 디자이너 세션의 Expo token은 `device_tokens.role='manager'`로 저장한다. `fc` role로 저장하면 FC 전체 대상 공지/시험 broadcast를 같이 받을 수 있다.
- `fc-notify`는 토큰 query에서 `role`을 함께 읽고, manager token은 `request_board_*` category 또는 `category='message'` + 구체적인 `target_id`가 있는 직접 채팅일 때만 유지한다.
- 설계매니저 unread badge는 fc-onboarding unread를 더하지 않고 live request_board unread만 사용한다.
- 게시판/공지/시험 알림을 추가하거나 수정할 때는 `supabase/functions/_shared/notification-delivery-policy.ts`와 `lib/mobile-unread-notification-count-plan.ts` 테스트를 함께 확인한다.

## 2026-07-06 Push Service Maintainability

- Web push/Expo fanout implementation belongs in `web/src/lib/push-notification-service.ts` and must remain server-only.
- `web/src/app/actions.ts` is only an authenticated server-action wrapper around that service. API routes that already verified a signed admin session should call the service directly.
- Mobile startup registration should reuse an Expo token that was already fetched in the registration effect instead of calling `getExpoPushTokenAsync` twice for the same attempt.
