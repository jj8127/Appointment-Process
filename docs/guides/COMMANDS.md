# Command Reference Guide

> Last verified: 2026-07-15
> Current release decision: **HOLD**

## 안전 등급

| 등급 | 의미 | 실행 규칙 |
| --- | --- | --- |
| `SAFE_LOCAL` | source/원격 상태를 바꾸지 않는 로컬 검사 | 현재 scope에서 실행 가능 |
| `LOCAL_STATE` | local server, emulator, generated output, local DB를 변경 | 대상이 local·폐기 가능함을 확인 |
| `READ_ONLY_EXTERNAL` | 외부 서비스 조회 | 해당 plugin과 read-only credential 사용 |
| `REMOTE_MUTATION` | deploy, push, DB/secret, 게시, EAS/Sentry 상태 변경 | 현재 대화의 명시적 승인 필수 |

`npm audit fix`, stash/reset/checkout, autofix lint/formatter는 기본 작업 흐름에서 금지한다.

## Sentry 업로드 차단

모든 build 예시는 먼저 네 가지 변수를 현재 PowerShell 프로세스에만 설정한다.

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'
```

upload/release/artifact mutation 흔적이 있으면 build는 실패다.

## 개발 서버

### Expo dev server — `LOCAL_STATE`

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
npm start
```

### Expo web dev server — `LOCAL_STATE`

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
npm run web
```

### Admin web dev server — `LOCAL_STATE`

```powershell
Set-Location D:\hanhwa\fc-onboarding-app\web
npm run dev
```

### Native local run — `LOCAL_STATE`

```powershell
npm run android
npm run ios
```

emulator/device 설치 상태를 바꿀 수 있다. EAS build와는 다르지만 대상 device를 확인한다.

## 기본 품질 gate — `SAFE_LOCAL`

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
git diff --check
node scripts/ci/documentation-governance.test.mjs
node scripts/ci/documentation-governance.mjs AGENTS.md
node scripts/ci/check-governance.mjs
npm run lint
npx tsc --noEmit
npm test -- --runInBand
npm run test:coverage -- --runInBand
```

handbook-sensitive change를 강제 재검증할 때:

```powershell
node scripts/ci/check-governance.mjs --require-handbook-sync
```

## Production-shape local build — `SAFE_LOCAL`

### Expo web export

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'

Set-Location D:\hanhwa\fc-onboarding-app
npm run build
```

`dist/`는 ignored generated output이다. 오래된 output을 배포 증거로 쓰거나 source로 commit하지 않는다.

### Admin web build

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'

Set-Location D:\hanhwa\fc-onboarding-app\web
npm run build
```

### Vercel production-shape input build

Vercel plugin으로 link/project 경계를 확인한 뒤 local build만 실행한다.

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'

Set-Location D:\hanhwa\fc-onboarding-app
vercel build --prod
```

이 명령은 deploy 승인이 아니다. remote env pull 또는 link 변경이 필요하면 먼저 범위를 확인한다.

## Node/ops tests — `SAFE_LOCAL`

```powershell
$nodeTests = @(
  Get-ChildItem -Path 'web\src\lib\*.test.ts','web\src\lib\*.test.node.ts','scripts\ops\*.test.mjs' -File
) | Sort-Object FullName | Select-Object -ExpandProperty FullName
node --test $nodeTests
```

## Supabase Edge — `SAFE_LOCAL`

### 전체 진입점 Deno check

```powershell
$edgeEntrypoints = Get-ChildItem -LiteralPath supabase\functions -Recurse -File -Filter index.ts |
  Sort-Object FullName |
  Select-Object -ExpandProperty FullName
deno check --frozen --config supabase/functions/deno.json $edgeEntrypoints
```

검사 범위를 줄여 기존 오류를 숨기지 않는다. changed-entrypoint와 full-scope 결과를 따로 기록한다.

### Board loopback smoke

```powershell
node scripts/testing/board-edge-handler-smoke.mjs
node scripts/testing/board-list-edge-handler-smoke.mjs
```

원격 Function 호출·배포 대신 loopback handler를 사용한다.

## Supabase local stack — `LOCAL_STATE`

```powershell
docker info
supabase start
supabase status
```

local DB가 폐기 가능하고 remote project를 가리키지 않는지 확인한 뒤에만:

```powershell
supabase db reset
supabase db lint
```

Docker가 없거나 daemon이 꺼져 있으면 `ENVIRONMENT_BLOCKED`로 기록한다. 원격 DB로 대체하지 않는다.

## Dependency audit — `SAFE_LOCAL`

```powershell
npm audit
Push-Location web
npm audit
Pop-Location
```

결과를 기록하되 `npm audit fix`는 실행하지 않는다.

## 통합 QA 기록 — `LOCAL_STATE`

```powershell
npm run qa:init:integrated
npm run qa:validate:integrated
```

initializer는 기존 결과 파일을 바꿀 수 있으므로 새 실행을 시작할 때만 사용한다. 현재 저장된 통합 QA의 FAIL/BLOCKED/SKIPPED를 녹색 gate로 해석하지 않는다.

## Sentry 조회 — `READ_ONLY_EXTERNAL`

Sentry plugin과 `SENTRY_READ_AUTH_TOKEN`만 사용한다.

```powershell
npm run ops:sentry-triage -- --dry-run
npm run ops:sentry-triage -- --last-seen-days 7 --summary-only
```

`SENTRY_AUTH_TOKEN`으로 읽기 fallback하지 않는다. issue resolve, release 생성, source-map upload는 `REMOTE_MUTATION`이다.

## 보험 브리핑 — 현재 `PAUSED`

다음은 token pair와 수동 local/staging E2E가 복구된 뒤의 읽기/입력 검증용이다.

```powershell
npm run ops:post-insurance-digest -- --check-existing
npm run ops:post-insurance-digest -- --input-file <sanitized-local-payload> --dry-run
```

실제 게시 명령은 `REMOTE_MUTATION`이다. 현재 자동화와 수동 게시는 모두 중지 상태다.

## 승인 전 실행 금지 — `REMOTE_MUTATION`

```text
git push
gh pr create
vercel deploy --prod
supabase db push
supabase functions deploy <function-name>
supabase secrets set ...
eas update ...
eas build ...
eas submit ...
Sentry issue/release mutation
보험 브리핑 실제 게시
```

승인 요청에는 environment, project, commit, lane, 비용 영향, smoke, rollback을 포함하고 secret 값은 넣지 않는다.

## 문제 해결

### Docker unavailable

```powershell
docker info
supabase status
```

daemon 연결 실패는 환경 차단이다. remote reset/push로 우회하지 않는다.

### Port/process 확인 — `SAFE_LOCAL`

```powershell
Get-NetTCPConnection -State Listen | Sort-Object LocalPort
Get-Process node,deno -ErrorAction SilentlyContinue
```

process 종료는 다른 작업 소유권을 확인한 뒤 수행한다.

### Android local data 제거 — `LOCAL_STATE`

```powershell
adb uninstall <local-package-id>
```

대상 device/package를 확인하고 폐기 가능한 테스트 앱에만 사용한다.

## 관련 문서

- 개발자 온보딩: [`../handbook/developer-onboarding.md`](../handbook/developer-onboarding.md)
- 운영 런북: [`../handbook/operations-runbook.md`](../handbook/operations-runbook.md)
- 배포 체크리스트: [`../deployment/DEPLOYMENT.md`](../deployment/DEPLOYMENT.md)
