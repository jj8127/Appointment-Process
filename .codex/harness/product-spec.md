# Completed Increment 36: Referral Graph Descendant-Sized Nodes

Admin referral graph nodes should now communicate total downstream organization size by default. A node's visual radius is based on all directed descendants in the full graph, excluding itself, not only its direct referral and inbound counts. The scale is capped logarithmic so large hubs stand out without covering labels, links, or nearby nodes.

This increment keeps `/api/admin/referrals/graph` unchanged. The client computes descendant counts from the full `allNodes/allEdges` graph and passes them into the canvas and drawer. Filters, search, selected-neighborhood depth, and "hide isolated" change which nodes are visible, but they do not change a visible node's size basis.

Out of scope: backend schema/API changes, new user toggles, graph mutation behavior, and broad physics redesign.

---

# Completed Increment 35: Request Board Designer Notification Scope

The current implementation narrows GaramIn request-board designer mobile notifications to the product scope the user requested: 설계요청 관련 알림 and the designer's own direct chat notifications only.

Request-board designer push tokens are registered as `manager`, `fc-notify` filters manager mobile tokens by category/target, and designer unread count uses live request_board unread only. Board, notice, exam, and FC-onboarding broadcast alerts should not reach the request-board designer mobile surface after the app/function changes are deployed and the device refreshes its token.

This increment does not change FC/admin notification delivery, request_board API behavior, board/exam authoring flows, or referral graph work.

---

# Completed Increment 34: Orange CTA Black Rendering Guard

The latest implementation hardens repeatedly reported Android black-surface rendering on GaramIn orange CTA/card surfaces. The home next-step and messenger CTA cards now use plain `View` surfaces with explicit `backgroundColor: HANWHA_ORANGE` instead of orange `LinearGradient`, and the same guard was applied to legacy mobile exam submit buttons and the referral-code card without changing their business flows.

This increment does not change exam application data flow, payment behavior, referral tree behavior, or board category behavior.

---

# Completed Increment 33: Board Garam Pick Category

The current implementation adds `가람 Pick` as a first-class board post category. It is seeded in schema and forward migration, appears through the existing dynamic board category APIs, and has a distinct badge color in mobile board, mobile admin board management, and admin web board views.

This increment does not change board permissions, notification fanout, notice/legacy-notice behavior, or attachment/comment/reaction contracts.

---

# Completed Increment 32: Dawichok URL Sent Signal And Referral Graph Completion Legend

The current completed implementation adds an explicit Dawichok URL sent signal and makes the referral graph legend easier to understand.

The Dawichok signal records `dawichok_url_sent_at/by`, gives secretary/admin users a `다위촉 URL 발송` action in mobile and web admin surfaces, and notifies the FC through the existing in-app/push path. FCs only see the exact copy `카카오톡으로 전송된 다위촉 URL을 진행해 주세요.` after that signal exists. Workflow downgrade/reset paths clear the signal so stale sent state is not shown.

The referral graph now computes `allCommissionsCompleted` from life/nonlife completion state, colors completed nodes green, shows the same state in the drawer, counts visible completed nodes after search/filter, and explains the color/ring legend in operator-friendly terms.

This increment explicitly excludes Toss virtual-account/proxy exam runtime, headquarters-scoped secretary filtering, Dawichok PDF removal, graph physics changes, and real Kakao provider/template integration.

---

# Completed Increment 31: GaramIn Operations UX And Workflow Fixes

The previous implementation addressed nine urgent GaramIn improvements across mobile admin exam registration, signup certificate capture, guarantee-insurance consent copy/date validation, document review, home CTA/video affordances, and manager full resident-number display.

That increment explicitly excluded the deferred Toss virtual-account/proxy exam application runtime and headquarters-scoped secretary filtering. Existing internal `allowance_*` schema/status names remain for compatibility, while user-facing copy changed to `보증 보험 동의`.

---

# Active Increment 30: Mobile Exam Runtime Rollback

The active mobile exam application behavior is the legacy FC flow: the FC directly enters `응시료 납입일`, and the mobile screens write/read `fee_paid_date` through `exam_registrations`.

The Toss/per-examinee virtual-account and proxy-application design is deferred. Its pure contract material can remain for later planning, but it must not be active mobile UI or deployable exam-payment runtime in this increment.

This increment is limited to exam/Toss runtime rollback notes and does not change Dawichok PDF or admin-scope sections.

---

# Product Spec: Evidence-Based Cleanup / Refactor Program

## Active Increment 29: GaramIn Nine-Item Operations Upgrade

The current active implementation upgrades GaramIn FC operations across mobile, admin web, and Supabase:

- FC home guidance and temp-id visibility.
- Dawichok terminology and secretary document-sent workflow.
- KakaoTalk delivery as a non-blocking extension of current notification events.
- Toss Payments rotating virtual accounts, one account per exam registration/examinee.
- Proxy exam applications for existing GaramIn FCs with submitter/examinee separation.
- Headquarters-scoped secretary/admin visibility with server-side enforcement.

The most important product constraint is payment traceability: when one FC applies for multiple examinees, each examinee registration receives its own Toss order and rotating virtual account. Grouping may exist only for UI/audit; payment matching stays per registration.

---

## Goal

`fc-onboarding-app` is an active production/work-in-progress FC onboarding and operations system. This long-running program identifies unnecessary, stale, duplicate, risky, or performance-harming code, documentation, configuration, dependencies, and assets, then removes or refactors them only when behavior preservation and rollback/verification are clear.

Increment 1 was inventory-only. Later increments remain evidence-based and scoped; generated output, docs, configuration, dependencies, and assets are not deleted without explicit proof and verification.

Latest active increment: Increment 28 `Admin Dashboard Operator Copy And File Open Fix` handles the 2026-06-03 admin web report that secretary/admin users see developer-facing wording in the FC detail modal and that uploaded-file `열기` does not work. The local fix replaces implementation wording with operator-facing Korean, keeps `fc-documents` access server-mediated through `/api/admin/fc`, normalizes storage URL/path inputs before signed URL creation, and opens a pending tab synchronously before async signing to avoid popup-blocker failures.

Latest completed increment: Increment 27 `Mobile Exam Round Registration/Delete Hotfix` handles the 2026-06-03 Garam in admin report that new exam registration fails and deleting an existing exam crashes. Live `admin-action` create/delete smoke passed, so the trusted backend write path remains the source of truth. The mobile fix closes the screen-level location payload drift by including the pending location input on save, requiring at least one existing/new location, and applying the same contract to life and nonlife exam registration screens. The delete crash maps to existing Sentry/AppAlert work in Increment 26 and still requires a fixed app release before production confirmation.

Previous completed increment: Increment 26 `Sentry AppAlert runOnJS Crash` fixes Sentry `REACT-NATIVE-3` by keeping function-bearing alert button objects out of Reanimated `runOnJS`, resolving the button on the JS side by index, and guarding `onPress` with `typeof onPress === 'function'`. No app route, schema/migration, env/secrets, package/lockfile, request_board bridge, push/notification fanout, admin web, or broader alert visual behavior changed.

Previous completed increment: Increment 25 `Coverage Generated Artifact Hygiene` classified Jest `coverage/` output as generated local state, added root `.gitignore` and `.vercelignore` coverage rules, and removed the current untracked generated coverage directory after path verification. No production source, tests, package scripts, dependencies, lockfiles, env, schema, route behavior, PII/auth/session behavior, notification fanout, request_board bridge contract, current `dist/`, admin web `.next`, or deployment build setting changed.

Previous completed increment: Increment 24 `Root TypeScript NoEmit Alignment` restored root `npx tsc --noEmit` as a passing local safety gate. The fix is intentionally narrow: localized TypeScript contract alignment in appointment submit, Hanwha commission submit/workflow input typing, referral app-session error classification, nullable referral-code response typing, and Daum postcode WebView event typings. No route names, schema, env, dependency, lockfile, PII/auth/session behavior, notification fanout, request_board bridge contract, or deployment setting changed.

Previous completed increment: Increment 23 `Admin Web Reset Password Public Route Guard` restored `/reset-password` as a public admin web route after no-redirect production smoke showed it was redirecting to `/auth`. The fix is intentionally narrow: shared public-path helper, direct Node characterization, and middleware wiring only.

Previous completed increment: Increment 22 `Empty Legacy Export Directory Cleanup` removed only the ignored, untracked, file-empty local generated directory trees `dist-web/` and `dist-web-new/` after proving they were old generated local export directories and not current build outputs. No production source, package script, deployment config, dependency, lockfile, env, schema, route, PII/auth, request_board bridge, notification, or UI behavior changed.

Latest reconciliation snapshot (2026-06-03): Increment 19 completion remains consistently reflected; Increment 20 closed verification debt; Increment 21 cleaned stale `dist-web-new2/`; Increment 22 cleaned empty legacy `dist-web/` and `dist-web-new/`; Increment 23 fixed the admin web password reset public route and recorded the redirect-following smoke guardrail; Increment 24 restored root TypeScript noEmit as a passing safety gate; Increment 25 cleaned untracked generated `coverage/` output and added ignore rules; Increment 26 fixed Sentry `REACT-NATIVE-3` at the alert runOnJS boundary; Increment 27 fixed mobile exam round location payload drift; Increment 28 fixed admin dashboard operator copy and uploaded-file open handling locally.

## Repository Role

- Repo: `E:\hanhwa\fc-onboarding-app`
- Remote: `https://github.com/jj8127/Appointment-Process.git`
- Current branch observed: `codex/referral-rollout-closeout`
- Git state at kickoff: clean
- Product role: mobile FC onboarding app, Next.js admin web dashboard, Supabase-backed data and Edge Functions, notification/bridge workflows.
- Adjacent active repo: `E:\hanhwa\request_board`
- Read-only candidate clones: `_codex_fc_onboarding_push_20260324_02`, `_codex_request_board_push_20260324_01`, `_tmp_fc_push2`
- Workspace support/artifacts: `long-running-app-harness`, `.claude`, `.codex`, `.codex-tmp`, `test-results`

## Primary Entry Points

- Mobile Expo app routes:
  - `app/index.tsx`
  - `app/dashboard.tsx`
  - `app/fc/new.tsx`
  - `app/appointment.tsx`
  - `app/admin-board-manage.tsx`
  - `app/board.tsx`
  - `app/request-board.tsx`
  - `app/request-board-messenger.tsx`
  - `app/request-board-review.tsx`
  - `app/chat.tsx`
  - `app/exam-apply.tsx`
- Admin web:
  - `web/src/app/dashboard/page.tsx`
  - `web/src/app/dashboard/board/page.tsx`
  - `web/src/lib/*`
- Supabase / operations:
  - `supabase/functions/fc-notify/index.ts`
  - `supabase/functions/*`
  - `supabase/migrations/*`
  - `scripts/ci/check-governance.mjs`
  - `scripts/*`

## Package Scripts

Root `package.json`:

- `npm run start`: Expo start
- `npm run android`, `npm run ios`: Expo native runs
- `npm run build`: `expo export --platform web`
- `npm run lint`: `expo lint`
- `npm test`, `npm run test:coverage`
- operational/reporting scripts under `scripts/*`

`web/package.json`:

- `npm run dev`: clean/kill old Next dev state, then `next dev`
- `npm run build`: clean Next build, then `next build`
- `npm run start`
- `npm run lint`

## CI / Governance / Operations Files

- `.github/workflows/governance-check.yml`: Node 20 governance check on PR/push, plus PR template validation on PR.
- `scripts/ci/check-governance.mjs`: required governance verification.
- `.gitignore`: ignores `node_modules/`, `.expo/`, `dist/`, `dist-web*`, `web-build/`, native output folders, local envs, `.codex/`, `.codex-tmp/`, `.claude/settings.local.json`, `testsprite_tests/`, `.vercel`, and related generated output.
- `vercel.json`: current root Vercel config builds the Next.js admin web from `web/` and outputs `web/.next`.
- `web/vercel.json`: web-local Vercel config builds Next.js output `.next`.
- Key docs already used for grounding:
  - `AGENTS.md`
  - `README.md`
  - `.claude/PROJECT_GUIDE.md`
  - `.claude/WORK_LOG.md`
  - `.claude/MISTAKES.md`
  - `docs/handbook/INDEX.md`
  - `docs/handbook/workflow-state-matrix.md`
  - `docs/handbook/mobile/fc-onboarding.md`
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
  - `docs/handbook/backend/admin-operations-api.md`
  - `docs/handbook/data/data-model-canon.md`
  - `docs/handbook/backend/notifications-inbox-push.md`

## High-Risk Contracts To Preserve

- Resident registration number handling:
  - full-view vs masked view must follow trusted-path contract
  - no plaintext/encrypted fallback regression
  - log masking must remain enforced
- Admin / manager authorization:
  - manager read-only behavior must remain intact
  - cookie-first web session restore must not regress
  - admin/head-manager paths require explicit characterization before changes
  - `web/src/lib/client-session-restore.ts` now characterizes client-side cookie-first restore choice, resident mask formatting, and manager read-only role calculation before broader dashboard/session cleanup.
- Cross-repo bridge contracts with `request_board`:
  - `REQUEST_BOARD_AUTH_BRIDGE_SECRET` must match request_board `FC_ONBOARDING_AUTH_BRIDGE_SECRET`
  - `REQUEST_BOARD_PASSWORD_SYNC_TOKEN` must match request_board `FC_ONBOARDING_PASSWORD_SYNC_TOKEN`
  - password sync and bridge identity behavior must not drift
  - `supabase/functions/_shared/request-board-password-sync.ts` now characterizes outbound password-sync body shape and dependency-injected fetch behavior before broader bridge/password-sync cleanup.
- Supabase schema and migration truth:
  - do not assume `schema.sql`, local migrations, and remote DB are synchronized without evidence
  - do not claim remote migration application without logs/CLI/API evidence
- Notification fanout:
  - board-create, board-update, `fc-notify`, and request_board bridge unread flows require characterization before refactor
  - mobile unread checkpoint keys must keep `role + residentId + requestBoardRole` scoping so GaramLink FC/designer bridge users do not share checkpoint state
  - mobile bridge unread planning must keep live request_board unread inclusion aligned with FC/requestBoardRole access and keep `exclude_request_board_categories` tied to that inclusion flag
  - mobile unread async orchestration must keep checkpoint reads non-initializing during polling, invoke `fc-notify` with the existing body, fetch live request_board unread only for included bridge roles, and preserve warning/zero fallback behavior
- Web trusted PII read/session matching:
  - admin/manager `session_resident` can be raw, digits-only, or hyphenated. Privileged routes must keep shared candidate generation before resident-number/session cleanup.
- Resident-number runtime fallback:
  - direct decrypt mode parsing must preserve degraded edge fallback visibility and must not reinterpret missing direct decrypt support as a masked-view policy change.
  - edge fallback request shape must preserve service-role headers, `admin-action` URL, action name, and `fcIds` payload contract.
  - edge fallback response validation must require HTTP ok, body `ok: true`, and object `residentNumbers`; failure message priority stays `message` then `error` then default.
  - edge fallback execution must preserve missing-env diagnostics, failed response `status`/`body` logging, and thrown failure prefixes.
  - `/api/admin/resident-numbers` request parsing must preserve current `fcIds` normalization: array-only, nullish-to-empty string coercion, trim, blank filtering, and first-seen dedupe.
  - `/api/admin/resident-numbers` route branch sequencing must preserve session rejection before rate-limit/body work, rate-limit rejection before JSON parsing, invalid JSON logging, empty-list short-circuit, success response, and generic read-failure response.
  - `/api/admin/exam-applicants` enrichment must preserve exam row defaults, shared phone candidate matching, profile-id `fcIds` de-dupe, full resident-number replacement, and the current `주민번호 조회 실패` fallback literal for missing profile/read values.
  - admin dashboard/profile resident-number birth-date display must use the shared hook/helper path so `/dashboard` modal and `/dashboard/profile/[id]` do not drift.
- Brand/domain boundaries:
  - `가람in` / `가람Link` labels and user-facing copy should not be normalized without explicit product decision

## Current Large / Risky Modules

These are refactor candidates, not deletion candidates.

- `app/dashboard.tsx` (~3954 lines): mobile dashboard, likely high UI/state coupling.
- `web/src/app/dashboard/page.tsx` (~3279 lines): admin dashboard and lifecycle coupling.
- `app/index.tsx` (~2422 lines), `app/admin-board-manage.tsx` (~2061 lines), `app/request-board-messenger.tsx` (~2057 lines), `app/board.tsx` (~2025 lines): large route/component surfaces.
- `supabase/functions/fc-notify/index.ts` (~1445 lines): notification side effects and delivery contract.

## Current Cleanup Hypotheses

All hypotheses require later proof before deletion or refactor.

- Generated/untracked build output: `dist/` contains Expo web output and is ignored. Root `npm run build` generates Expo web static output and current docs now require rebuilding it fresh for any intentional static deployment. Action: deletion deferred; this is local generated output, not source cleanup.
- Stale docs: `README.md` and `AGENTS.md` disagreed on linked designer profile count (`54` vs `59`). Action: corrected in increment 2 by aligning `README.md` to the README-declared source of truth, `AGENTS.md`; no fresh live DB verification was claimed.
- Stale deployment docs: admin web Vercel deployment and Expo static export instructions were mixed in deployment/command docs and `CLAUDE.md`, including stale `dist/web` wording. Action: corrected in increment 3; no production deployment verification was claimed.
- Oversized UI modules: dashboard/admin/board routes are likely extraction candidates. Action: defer until characterization tests or stable contracts exist.
- Duplicate or drifting contracts: mobile/web/dashboard/bridge flows may duplicate identity, notification, or session restoration logic. Action: defer pending targeted search and tests.
- PII/session phone candidate drift: `buildPhoneCandidates` was embedded in `server-session` while multiple admin routes depend on the same raw/digits/hyphenated contract. Action: increment 4 extracted the helper to `web/src/lib/phone-candidates.ts` with characterization coverage while preserving `server-session` re-export.
- Resident-number runtime mode drift: `FC_IDENTITY_DIRECT_DECRYPT_MODE` parsing was embedded in `server-resident-numbers`; invalid mode handling defaulted to `auto` with a warning. Action: increment 5 extracted the parser to `web/src/lib/resident-number-runtime.ts` with characterization coverage; direct decrypt and edge fallback behavior were not otherwise changed.
- Resident-number edge fallback request drift: fallback request URL, service-role headers, action name, and payload were embedded inline in `server-resident-numbers`. Action: increment 6 extracted request building to `web/src/lib/resident-number-edge-fallback.ts` with characterization coverage; fetch execution/response parsing were not otherwise changed.
- Resident-number edge fallback response drift: fallback response validation and failure-message extraction were embedded inline in `server-resident-numbers`. Action: increment 7 extracted response parsing to `web/src/lib/resident-number-edge-response.ts` with characterization coverage; fetch execution/request shape were not otherwise changed.
- Resident-number edge fallback execution drift: missing-env checks, fallback fetch execution, failed response logging, and thrown error prefixes were embedded inline in `server-resident-numbers`. Action: increment 8 extracted execution to `web/src/lib/resident-number-edge-executor.ts` with dependency-injected characterization coverage; direct decrypt, request shape, response parsing, and route behavior were not otherwise changed.
- Resident-number route request parsing drift: `/api/admin/resident-numbers` normalized `fcIds` inline before the shared trusted read path. Action: increment 9 extracted request `fcIds` normalization to `web/src/lib/resident-number-route-request.ts` with characterization coverage; authorization, rate limiting, empty-list response, and downstream resident-number behavior were not otherwise changed.
- Resident-number route branch drift: `/api/admin/resident-numbers` owned session rejection, rate-limit, JSON parsing, empty-list, read success, and read failure branches inline. Action: increment 13 extracted branch orchestration to `web/src/lib/resident-number-route-handler.ts` with dependency-injected characterization coverage; session verification internals, rate-limit implementation, PII read behavior, direct decrypt, and edge fallback were not otherwise changed.
- Exam-applicant resident-number enrichment drift: `/api/admin/exam-applicants` owned exam row defaults, profile alias matching, resident-number read id derivation, and full-view enrichment inline. Action: increment 14 extracted those pure mapping pieces to `web/src/lib/exam-applicant-resident-number-enrichment.ts` with characterization coverage; auth/session, staff verification, rate limits, Supabase query shape, direct decrypt, edge fallback, and UI were not otherwise changed.
- Resident-number birth-date display drift: `/dashboard` modal used `useResidentNumber().birthDateDisplay`, while `/dashboard/profile/[id]` duplicated birth-date parsing from `residentNumberDisplay`. Action: increment 15 extracted `formatResidentNumberBirthDateDisplay` to `web/src/lib/resident-number-display.ts` and rewired both surfaces through the hook/helper path; resident-number fetch, trusted path, auth, direct decrypt, edge fallback, and UI layout were not otherwise changed.
- Client session restore/read-only drift: `web/src/hooks/use-session.tsx` owned cookie-first restore selection, resident mask formatting, and manager read-only calculation inline. Action: increment 16 extracted those pure pieces to `web/src/lib/client-session-restore.ts` with characterization coverage; cookie parsing/writing, localStorage encoding/persistence, hydration, login/logout, server session validation, middleware, dashboard authorization, manager write-protection UI, and layout were not otherwise changed.
- Request board password-sync outbound drift: `supabase/functions/_shared/request-board-password-sync.ts` owned outbound body construction and fetch execution privately. Action: increment 17 exported and characterized the current body builder for FC, manager, designer, developer FC mirror, blank optional fields, and no-trim behavior; increment 18 exported a dependency-injected sync helper and characterized skip, fetch init, timeout cleanup, warning, response parsing, and non-throwing error behavior. Env/secrets, caller role decisions, and request_board inbound behavior were not otherwise changed.
- Mobile bridge unread checkpoint drift: `notification-checkpoint.ts` generated unread checkpoint keys inline while `mobile-unread-notification-count.ts` depends on the key scope before combining fc-onboarding and live request_board unread counts. Action: increment 10 exported the existing key builder and added characterization coverage for `guest/global/none`, resident id trimming, and FC/designer request_board role isolation; storage/network/UI behavior was not otherwise changed.
- Mobile bridge unread plan drift: `mobile-unread-notification-count.ts` embedded request_board access, `fc-notify` `exclude_request_board_categories`, and final live request_board unread addition inline. Action: increment 11 extracted pure planning/body/total helpers with characterization coverage; AsyncStorage/Supabase/request_board/native badge/UI behavior was not otherwise changed.
- Mobile unread async orchestration drift: `mobile-unread-notification-count.ts` embedded checkpoint read, `fc-notify` invocation, optional request_board unread fetch, and fallback logging inline. Action: increment 12 extracted the orchestration into a dependency-injected helper with characterization coverage; runtime dependencies and behavior remain unchanged.
- Obsolete dependencies: root and web packages use separate React/Supabase versions. Action: defer; package split may be intentional and must be checked with build/runtime evidence.

## Non-Goals For Increment 1

- No source code edits.
- No deletion of code, docs, assets, generated output, dependencies, lockfiles, or configuration.
- No schema, migration, env, secret, notification, or auth behavior changes.
- No git history rewriting or destructive commands.

## Current Deferred Meeting Items

- 시험 대리 신청 + Toss Payments 회전식 가상계좌: deferred by user; current runtime should stay on the previous fee-date flow until resumed.
- KakaoTalk/AlimTalk real provider integration: not complete; inbox/push copy and internal notification work exist, but provider credentials/adapter rollout remains.
- Dedicated 다위촉 guide image assets: pending supplied assets and final placement.
- Full on-device traversal of every onboarding/exam workflow on SM_S942N: still required before claiming full UI completion.

## Increment 22 Product Decisions

- All active 본부장/manager profiles should default to 김형수(`01094272550`) as recommender through trusted server/database paths.
- 김형수 self-referral remains invalid; if 김형수 is also a manager, his own row must not point to itself.
- Date-field wording is exact: `보증보험 조회 동의일`.
- Generic step wording may continue to use `보증 보험 동의` where it describes the overall workflow step rather than the date field.
- Admin referral graph colors are global status semantics, with yellow reserved for the viewer/current highlighted role node rather than a status bucket.

## Increment 25 Product Decisions

- 모바일 가람Link 홈의 FC 액션 목록에 `고객관리` 진입을 추가한다.
- `고객관리`는 별도 신규 시스템이 아니라 기존 설계 요청 작성 플로우의 `1. 고객` 화면으로 들어가는 entrypoint다.
- 기존 `새 설계 요청` 진입은 깨지지 않아야 하며, 설계매니저 세션에는 FC 고객관리/작성 진입을 열지 않는다.
- 이번 increment는 모바일 홈/작성 진입 helper/test에 한정하고, request_board 서버/API나 관리자 웹은 변경하지 않는다.

## Increment 29 Product Decisions

- 본부장은 시험 신청도 가능해야 하지만, 기존 시험 목록과 시험 명단 조회 기능을 잃으면 안 된다.
- 본부장 시험 홈은 FC 신청 전용 화면이 아니라 `시험 관리/신청` 화면이다.
- 본부장 시험 홈은 기존 시험 일정/신청자 관리 카드와 생명/손해 시험 신청 카드를 함께 제공한다.
- 본부장은 read-only 관리자로 유지되므로 시험 일정 편집/삭제 같은 쓰기 액션은 기존 화면의 `readOnly` guard에 따라 막힌다.

## Increment 30 Product Decisions

- 추천인 그래프는 root 주변 원형 분배를 기본 모양으로 쓰지 않는다.
- 사용자가 그린 스케치처럼 연결된 그룹은 길게 뻗는 branch/trunk 느낌이어야 하며, 자식 허브는 부모로부터 충분히 긴 엣지를 갖는다.
- 자식이 없는 terminal 노드는 부모 주변에 짧게 배치하되, crowded fan에서는 엣지 길이를 조금씩 다르게 해서 노드가 겹치지 않게 한다.
- 엣지는 직선으로 유지하고, 색/굵기/alpha가 엣지마다 달라지는 의미 없는 구분은 하지 않는다.
- 실제 운영 데이터 기준 검증을 우선한다. 합성 fixture에서 좋아 보여도 `RUN_REFERRAL_GRAPH_REALDATA_TEST=1` 실제 Supabase graph 지표가 나빠지면 완료로 보지 않는다.
