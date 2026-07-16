# FC 릴리스·배포 체크리스트

> Last verified: 2026-07-16
> Current decision: **릴리스 HOLD**
> Scope: Expo app/web, Next admin web, Supabase migration/Edge, native binary

이 문서는 승인된 릴리스 창의 순서와 rollback 기준을 정의한다. 명령을 적어 둔 것은 실행 승인이 아니다. 최신 로컬 전체 영수증은 FC 18/18, Deno 46/46, root·web TypeScript를 포함해 녹색이지만 원격 caller rollout, migration, 인증 E2E와 credential incident 대응 증거가 없으므로 실제 배포는 금지 상태다.

## 1. 변경 동결과 기준선

- [ ] 명시적 릴리스 승인자와 대상 환경이 기록돼 있다.
- [ ] branch, HEAD, `git status --short`, commit 범위가 기록돼 있다.
- [ ] 설명할 수 없는 dirty/untracked 파일이 배포 입력에서 제외됐다.
- [ ] P0/Critical·High, 인증 E2E, credential incident 차단점의 disposition이 승인됐다.
- [ ] secret 값이 아닌 이름·defined/missing 상태만 점검했다.
- [ ] rollback owner, 관측 담당, 중단 조건이 정해졌다.

현재 HOLD에서는 이 절을 확인한 뒤 실제 배포로 진행하지 않는다.

## 2. 공통 로컬 gate

모든 build는 source-map/release upload를 강제로 차단한다.

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'

git diff --check
node scripts/ci/documentation-governance.test.mjs
node scripts/ci/check-governance.mjs
npm run lint
npx tsc --noEmit
npm test -- --runInBand
npm run test:coverage -- --runInBand
npm run build
```

Admin web gate:

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'

Push-Location web
npm run lint
npx tsc --noEmit
npm run build
Pop-Location
```

Node/ops test gate:

```powershell
$nodeTests = @(
  Get-ChildItem -Path 'web\src\lib\*.test.ts','web\src\lib\*.test.node.ts','scripts\ops\*.test.mjs' -File
) | Sort-Object FullName | Select-Object -ExpandProperty FullName
node --test $nodeTests
```

Edge gate:

```powershell
$edgeEntrypoints = Get-ChildItem -LiteralPath supabase\functions -Recurse -File -Filter index.ts |
  Sort-Object FullName |
  Select-Object -ExpandProperty FullName
deno check --frozen --config supabase/functions/deno.json $edgeEntrypoints
node scripts/testing/board-edge-handler-smoke.mjs
node scripts/testing/board-list-edge-handler-smoke.mjs
```

Dependency audit는 수정 없이 실행한다.

```powershell
npm audit
Push-Location web
npm audit
Pop-Location
```

- [ ] 각 명령의 commit, 종료코드, duration, 실패 분류가 receipt에 있다.
- [ ] `npm audit fix`, autofix formatter/lint는 실행하지 않았다.
- [ ] upload/release/artifact mutation이 없었다.
- [ ] 기존 부채와 신규 회귀를 분리했으며 검사 범위를 줄이지 않았다.

현재 기준 영수증 `quality-full-20260716-015916`은 FC 18/18을 통과했고, 전체 Edge Deno 46/46과 root·web TypeScript도 PASS다. web Node 228 PASS / 1 SKIP 중 `referral-graph-realdata` skip은 실제 Supabase 데이터와 외부 자격증명이 필요한 `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`다. 공유·운영 DB로 대신 실행하지 않는다. credential 상태는 active tracked copy 0, local untracked copy 6, 과거 tracked 노출 확인이며 외부 rotate/history/clone 평가는 계속 차단 상태다.

## 3. 배포 lane 분리

한 번에 섞지 않고 다음 lane별로 입력, smoke, rollback을 따로 승인한다.

| Lane | 입력 | 최소 smoke | rollback 기준 |
| --- | --- | --- | --- |
| Expo static web | fresh ignored `dist/` export | public entry와 핵심 route | last-known-good static artifact |
| Admin web | `web/` + root Vercel config | `/auth`, signed protected route, role boundary | last-known-good Vercel deployment |
| Auth caller | mobile/web/runner signed-session transport | token attachment, re-login, same-origin proxy | caller hotfix 또는 release pause |
| Auth enforcement | FC notify + 17 Board Functions | auth allow/deny와 active actor binding | forward Edge correction; insecure fallback 금지 |
| DB-compatible caller | old/new DB 호환 artifact 또는 RPC 기능 비활성 | RPC 부재 환경에서 신규 path가 호출되지 않음 | feature off 또는 last-known-good caller |
| DB migration | immutable additive Board/exam RPC SQL + schema parity | RPC existence/grant, representative transaction | forward corrective migration |
| RPC activation | `board-update` handler와 admin-web exam schedule action | atomic success/failure와 partial-write 0건 | feature off 또는 안전 artifact; split write 복구 금지 |
| Native | versioned Android/iOS binary | install/login/navigation/bridge | store/native rollback plan |

각 lane 실패는 다른 lane의 성공으로 덮지 않는다.

## 4. 서로 독립적인 두 rollout 축

`caller-first`는 인증 caller 채택을 설명하는 말이다. DB/API version ordering에는 사용하지 않는다.

### 4.1 인증 축: signed caller를 먼저, Edge enforcement를 나중에

1. **Auth Caller A**
   - mobile Board/notify transport가 signed app-session을 첨부한다.
   - admin web이 signed same-origin proxy와 HttpOnly session을 사용한다.
   - runner는 최소 권한 token 형식을 채택하되 보험 브리핑은 계속 PAUSED다.
2. **채택 관측**
   - token 보유율, 재로그인 영향, old caller 실패율을 비식별 count로 확인한다.
3. **Auth Enforcement B**
   - FC notify와 17개 Board Function의 body-actor 신뢰를 같은 통제 창에서 닫는다.
   - body actor와 bridge-secret app-session fallback을 두지 않는다.
4. **인증 smoke**
   - disposable local/staging FC, manager, admin/developer와 runner allow/deny를 검증한다.

`board-update`는 17개 중 하나이면서 새 RPC caller다. 따라서 Auth Enforcement B 창은 signed caller 채택뿐 아니라 아래 Board migration 검증까지 충족해야 시작할 수 있다. FC notify와 다른 Board handler의 인증 원칙 자체는 DB rollout 순서와 별개다.

### 4.2 DB 원자 RPC 축: 호환 caller, migration, 활성화, 정리

1. **A — old/new DB 호환 또는 기능 비활성**
   - migration 전 artifact는 old/new DB 모두에서 안전하거나 새 RPC path가 feature-disabled여야 한다.
   - 현재 local `board-update` handler와 admin-web exam schedule action은 RPC-required다. 둘을 A단계 호환 artifact로 배포하지 않는다.
   - 호환 dual-path가 필요하면 두 DB version에서 atomicity를 보존해야 한다. multi-statement split write fallback은 허용되지 않는다.
2. **B — additive migration 적용·검증**
   - Board의 `20260712000001_atomic_board_post_update.sql`을 적용하고 `update_board_post_atomic` 존재, revoke/grant, representative transaction을 검증한다.
   - Exam의 `20260712000002_atomic_exam_round_save.sql`을 별도로 적용하고 `save_exam_round_atomic` 존재, revoke/grant, representative transaction을 검증한다.
3. **C — 새 RPC caller 활성화**
   - `board-update`: Board migration B와 인증 caller 채택이 모두 확인된 뒤, 17개 Board Auth Enforcement B 통제 창에서 새 handler를 배포·활성화한다.
   - admin-web exam schedule: Exam migration B를 확인한 뒤 새 `saveExamRoundAction`을 포함한 admin-web artifact를 별도 web release로 활성화한다. Board Edge 창과 묶지 않는다.
4. **D — 관측·auth smoke 후 legacy/compat 제거**
   - atomic success/failure, partial-write 0건, role allow/deny, 재로그인, RPC error rate를 관측한다.
   - 관측 창이 통과한 뒤에만 feature flag, held legacy artifact, capability check 같은 compat를 제거한다.

RPC가 없으면 새 caller를 활성화하지 않는다. rollback은 feature off, held safe artifact 또는 forward correction을 사용하며 multi-statement write로 되돌리지 않는다.

## 5. Lane별 체크리스트

### Expo static web

- [ ] ignored output을 새로 생성했고 checkout의 오래된 `dist/`를 재사용하지 않았다.
- [ ] build에 네 가지 Sentry 차단값이 적용됐다.
- [ ] public entry, auth, navigation, bridge entry를 local preview로 확인했다.
- [ ] source가 아니라 generated output만 배포 입력이다.

### Admin web

- [ ] root `vercel.json`과 `web/` build 경계가 일치한다.
- [ ] `/auth`와 public route는 session 없이 열리고 protected route는 signed session을 요구한다.
- [ ] manager read-only, admin write, developer subtype 경계를 확인했다.
- [ ] `/api/fc-notify`와 `/api/board`는 exact origin/session/allowlist를 검증한다.

### Migration

- [ ] 새 migration은 additive이고 이미 적용된 파일을 수정하지 않았다.
- [ ] `supabase/schema.sql`과 migration이 같은 RPC/schema를 나타낸다.
- [ ] `public`, `anon`, `authenticated` revoke와 `service_role` grant를 확인했다.
- [ ] representative failure가 partial write를 남기지 않는다.
- [ ] Board migration 검증 전 `board-update` RPC caller가 활성화되지 않았다.
- [ ] Exam migration 검증 전 admin-web exam schedule RPC action이 활성화되지 않았다.
- [ ] backup/restore owner와 forward correction SQL이 준비됐다.

### Edge Functions

- [ ] changed-entrypoint와 full Deno 결과를 모두 기록했다.
- [ ] signed claim이 active DB actor에 다시 결합된다.
- [ ] body actor/role/phone과 forwarding header가 권한 근거가 아니다.
- [ ] attachment ownership, canonical path, object size/MIME를 서버에서 재검증한다.
- [ ] notification은 redaction 후 bound하며 raw upstream body를 기록하지 않는다.
- [ ] `board-update` 배포는 signed caller 채택과 Board RPC migration 검증을 모두 만족한다.

### Native

- [ ] `app.json` visible version을 확인하고 새 binary는 버전을 올렸다.
- [ ] platform, profile, 현재/제안 version, 비용 영향 명령을 사용자에게 제시했다.
- [ ] OTA와 native build를 혼동하지 않았다.
- [ ] store submit과 rollout percentage가 별도로 승인됐다.

## 6. Smoke와 관측 창

최소 smoke:

1. FC/admin/developer/manager login allow/deny와 재로그인.
2. FC onboarding read/write, manager read-only.
3. Board list/detail/create/update와 attachment ownership denial.
4. Exam atomic save/delete, notification 실패 후 DB commit 상태.
5. 가람Link bridge login/session sync와 role normalization.
6. inbox row, push fanout, deep link를 각각 확인.
7. 로그/Sentry에 JWT, 전화번호, 주민번호, raw upstream body가 없는지 확인.

관측 창에는 error rate, auth denial class, RPC failure, push/inbox mismatch, old caller failure를 비식별 count로 본다. 인증 E2E를 수행하지 못하면 릴리스 성공으로 종료하지 않는다.

## 7. 중단과 rollback 기준

즉시 중단:

- auth bypass 또는 정상 caller의 광범위한 401/403
- partial write, attachment ownership 위반, 데이터 손실
- PII/JWT/token/raw body logging
- RPC/function version mismatch
- Sentry upload/release mutation이 local gate에서 발생
- smoke role 중 하나라도 핵심 흐름 실패

rollback 원칙:

- insecure body-actor 또는 bridge-key fallback을 복구하지 않는다.
- 적용된 migration 파일을 되돌려 편집하지 않는다.
- DB는 additive forward corrective migration을 사용한다.
- Edge는 보안 경계를 보존하는 forward correction 또는 통제된 이전 안전 artifact를 사용한다.
- client adoption 문제는 caller 보완, 강제 재로그인 안내, rollout pause로 해결한다.

## 8. 명시적 승인 후에만 가능한 원격 명령

아래는 로컬 검증이 아니며 현재 HOLD 상태에서는 실행하지 않는다.

```text
vercel deploy --prod
supabase db push
supabase functions deploy <function-name>
supabase secrets set ...
eas update ...
eas build ...
eas submit ...
```

승인 요청에는 환경, project, lane, commit, migration/function 목록, smoke, rollback, 비용 영향을 함께 제시한다. secret 값은 명령 예시나 승인 메시지에 넣지 않는다.

## 9. 완료 판정

- [ ] 모든 필수 local gate가 녹색이거나 owner·기한이 있는 승인된 예외다.
- [ ] signed caller 채택이 Edge auth enforcement보다 먼저였다.
- [ ] Board/Exam RPC migration 적용·검증이 각각의 새 RPC caller 활성화보다 먼저였다.
- [ ] 인증 E2E와 관측 창이 통과했다.
- [ ] rollback/forward correction이 실제 대상 version에 맞다.
- [ ] P0/Critical·High와 tracked secret incident가 닫혔다.

하나라도 비어 있으면 결론은 **릴리스 HOLD**다.
