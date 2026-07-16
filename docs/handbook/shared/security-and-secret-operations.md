doc_id: SHARED-SECURITY-SECRET-OPS
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-07-16
source_of_truth: env contracts + reset-password functions + supabase/functions/_shared/board.ts + web/src/lib/server-session.ts + web/src/app/api/fc-notify/route.ts + web/src/app/api/board/route.ts + admin service-role callers

# Security And Secret Operations

## 2026-07-16 Diagnostic Privacy Contract

- Privacy filtering happens before the first sink. The mobile and admin-web shared loggers sanitize the message, structured payload, and `Error` name/message/stack before any `console.*` serialization or Sentry-adjacent capture call. Sentry `beforeSend` remains defense in depth, not the primary logger boundary.
- Diagnostic serialization must redact bearer/JWT-like credentials, Korean and international mobile numbers, resident numbers, Expo push tokens, OTP-labelled values/keys, raw upstream or response bodies, filenames, and storage object paths. Non-sensitive classification fields such as fixed `reason`, numeric/provider `status`, and error class name remain intact.
- Push registration/API, signup OTP, and group-chat provider/database diagnostics use reviewed fixed reason/status fields only. Test mode never prints an OTP or destination identifier, and provider response bodies are not copied into logs or user-facing errors.
- Edge diagnostics for the reviewed auth/referral, Request Board password bridge, notification fanout, presence fallback, Board database/view/attachment, and account-cleanup failures terminate at `supabase/functions/_shared/edge-diagnostic.ts`. Its input is a closed event/reason union with only bounded numeric `status`/`count`, boolean `retryable`, and a coarse allowlisted `errorClass`; it cannot accept raw `Error`, message/stack/cause, response body, URL/path, identifier, phone, referral code, or affiliation fields. The runtime reconstructs output field by field and emits a fixed fallback for an invalid event/reason pair.
- The 2026-07-16 reviewed 14-file inventory now contains exactly 9 direct-console sinks, all explicitly reviewed single-literal non-sensitive diagnostics; the unproven count is zero. The exact call-and-anchor allowlist is a regression fence: every variable/error diagnostic must use the closed Edge helper or a sanitized structured logger, and any new or rewritten direct sink requires classification plus evidence.
- Local proof uses malicious samples and positive controls through logger/Sentry-adjacent boundaries plus frozen Deno checks. Production Supabase log replay, live Sentry inspection, and device push delivery remain external rollout checks and do not become green from local source tests alone.

## 2026-07-12 FC Notify Dual-Ingress Secret Contract

- Browser `/api/fc-notify` calls require the source origin to match the actual request URL's scheme plus canonical Host and a verified signed server session. `X-Forwarded-Host` alone is not authorization evidence.
- FC sessions bind the signed token's `fcId` and resident phone to the same `signup_completed=true` profile before any privileged notification read or send.
- Request Board uses a dedicated pair: sender `FC_ONBOARDING_NOTIFY_TOKEN`, receiver `REQUEST_BOARD_NOTIFY_TOKEN`. Both missing and mismatched values fail closed; no other bridge secret or service-role key is an authentication fallback.
- The sender accepts only the exact HTTPS `/api/fc-notify` endpoint, with plain HTTP limited to localhost development checks. The receiver compares SHA-256 digests with `timingSafeEqual`, never logs the token, and rebuilds the outbound payload from an action/category allowlist.
- Both sides redact complete title/body values before applying identical 120/2000-character bounds. Browser callers omit sender identity and direct notification inserts; the route derives identity and the Edge Function remains the single notification-row writer.
- Deploy sender/token first and the hardened receiver second. If the protected receiver rollout fails, keep the receiver closed, repair token parity, or temporarily disable bridge fanout. Never restore the unauthenticated raw-body proxy as a rollback.

## 2026-07-12 Board App-Session And Automation Contract

- A phone number, role, CORS origin, or active account row is not proof of possession. Every Board
  request is authorized by either a signed `x-app-session-token` rebound to the active DB actor or the
  narrow automation ingress below. The service-role client is used only after that decision.
- Mobile keeps the signed token in secure app-session storage. Admin web keeps it in the HttpOnly
  `web_app_session` cookie and reaches Board through the signed same-origin `/api/board` proxy. The
  login route must strip `appSessionToken` from public JSON.
- `BOARD_AUTOMATION_TOKEN` is a dedicated high-entropy exact-match secret paired between the
  insurance-digest runner and Edge secrets. `BOARD_AUTOMATION_ACTOR_PHONE` must be an active admin;
  `BOARD_AUTOMATION_ACTOR_NAME` is server configuration, never request authority.
- Automation may read categories/list and create only `보험소식 브리핑 ...` in canonical `general`.
  Missing category is a blocker. It may not create categories or reach update/delete/pin/attachment.
- Rotate the runner and Edge token together. Empty, near-match, wrong-action, and wrong-category
  requests fail closed. Never log the token or include it in dry-run payloads.
- Authentication rollout is caller first: deploy signed mobile/web/runner transports, verify adoption
  and admin re-login, then enforce actor-bound authentication across FC notify and all 17 Board Edge
  handlers in one controlled window. Partial Board auth rollout can reopen a sibling confused-deputy
  path. This rule does not define DB/RPC version ordering.
- Atomic RPC rollout is a separate compatibility sequence: (A) old/new-DB-compatible caller or
  feature-disabled RPC path, (B) additive migration plus existence/grant/transaction verification,
  (C) new RPC caller activation, then (D) observation and auth smoke before removing legacy/compat.
- The current `board-update` handler is RPC-required: activate it only after the Board RPC migration
  is verified and signed caller adoption is proven, as part of the 17-Board auth enforcement window.
  The admin-web exam schedule action is also RPC-required: activate it in a separate web release only
  after the Exam RPC migration is verified. Neither current artifact is an A-stage compatible caller.
- Never use multi-statement writes as a compatibility or rollback path. Use feature-off/held safe
  artifacts before activation and additive forward correction after migration.

## 2026-07-12 Local Sentry Build Deny Contract

- A local verification build is safe only when `SENTRY_DISABLE_UPLOAD=1` reaches the final Sentry
  plugin config and forces both `authToken: undefined` and `sourcemaps.disable=true`.
- Clearing a parent-shell token is insufficient because Next may reload an ignored `.env.local`.
  Route unexpected traffic to a loopback-only `SENTRY_URL` and inspect output for upload/release/
  artifact activity; build success does not excuse an external mutation.

## 2026-07-07 Supabase Functions Lockfile

- `supabase/functions/deno.lock` is a runtime dependency contract for Edge Functions. Changes to it must be reviewed with the function code that caused the lock update, and must not be treated as an unrelated generated artifact.

## 2026-07-06 Trusted Session And Push Token Contract

- Privileged admin web routes must verify the signed server session. Raw `session_role` or `session_resident` cookies are not an authorization source outside the explicit session helper/proxy boundary.
- `device_tokens` must be treated as service-role-only storage. Register/delete goes through `device-token-register`; fanout goes through server routes or server-only helpers.
- Request Board bridge-token compatibility and FC app-session signing are separate HMAC trust domains.
  App sessions are signed only by `FC_APP_SESSION_TOKEN_SECRET` and verify only that current key plus
  `FC_APP_SESSION_TOKEN_PREVIOUS_SECRET`; `REQUEST_BOARD_AUTH_BRIDGE_SECRET` is never an app-session
  minting or verification fallback.

## 반드시 문서화되는 항목

- root/web/request_board env secret inventory
- bridge/password-sync shared secret pairing
- service-role caller 목록
- resident number / SSN / phone identity 처리 규칙
- SMS reset bypass/test-code 운영 규칙
- push/VAPID/admin push secret 범위

## 운영 실수 주의

- `SMS_BYPASS_ENABLED` 또는 test code를 production처럼 사용하지 않습니다.
- service-role 키가 있는 로컬 스크립트를 운영 DB에 바로 실행하지 않습니다.
- bridge secret은 양 저장소를 같은 변경 세트로 회전합니다.
- web localStorage/cookie를 “강한 서버 세션”으로 오해하지 않습니다.
- 그렇다고 client restore가 localStorage만 보고 cookie를 무시하면 안 됩니다. admin web은 middleware/server route가 cookie를 기준으로 세션을 판단하므로, client restore는 cookie-first로 정렬하고 localStorage는 fallback/cache로만 사용합니다.
- admin/manager cookie `session_resident`는 digits-only 원문으로 단정하지 않습니다. privileged server route는 raw / digits / hyphenated 후보를 함께 검증해야 하며, 포맷 차이 때문에 PII read가 막히면 security-hardening이 아니라 regression입니다.

## break-glass 메모

- 비밀번호 reset 계열은 가람in이 canonical entrypoint입니다.
- request_board의 reset UI는 proxy일 뿐 독립 정책 원천이 아닙니다.
- PII export/조회는 resident-number API 또는 owning secure path만 사용합니다.

## 2026-03-28 운영 메모

- `request-signup-otp`와 `set-password`는 로그인/가입 시 shared commission initializer를 거치므로, 위촉 단계 필드(`hanwha_commission_*`, 보험 위촉 제출/승인 필드) 초기화 규칙과 같이 검토해야 합니다.
- `set-password`는 OTP로 검증된 기존 profile만 승격하고, duplicate/direct call에서는 `password_set_at`를 먼저 확인한 뒤에만 reset/update를 수행해야 합니다. fresh-number bypass나 기존 추천인/온보딩 상태 wipe는 security regression으로 취급합니다.
- 모바일/웹 push fanout은 `device_tokens.role='admin'`만 전제하면 안 됩니다. 총무 기기가 `manager` role로 등록될 수 있으므로, FC 제출 알림은 `admin`과 `manager` 토큰을 모두 포함해야 합니다.

## 2026-04-23 signup/password + web push 운영 메모

- `request-signup-otp`는 신규 번호 bootstrap 시 `fc_profiles` 추천인 current-state snapshot(`recommender_fc_id`, `recommender_code_id`, `recommender_code`, `recommender_linked_at`, `recommender_link_source`)을 비운 기본 row를 만든다. bootstrap 단계에서 legacy display 값만 남기거나 임의 provenance를 넣지 않는다.
- `set-password`는 회원가입 추천인 확정 시 `supabase/functions/_shared/referral-link.ts`의 `applyReferralLinkState(...)`를 통해서만 invitee current-state를 쓴다. OTP/password 경로가 `fc_profiles` 추천인 컬럼을 ad-hoc update로 따로 건드리면 security/contract regression으로 본다.
- admin web browser push는 `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, `ADMIN_PUSH_SECRET`가 모두 있을 때만 fully configured 상태다. preview 배포처럼 값이 빠진 환경에서는 실패를 숨기지 말고 “설정되지 않은 배포” 상태를 명시적으로 보여줘야 한다.
- admin web의 request-board deep link는 `NEXT_PUBLIC_REQUEST_BOARD_URL`이 없으면 production fallback으로 새면 안 된다. 설정이 빠진 배포에서는 disabled 상태로 남겨야 한다.
