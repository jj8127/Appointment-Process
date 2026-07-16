doc_id: FC-HANDBOOK-DEVELOPER-ONBOARDING
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer
last_verified: 2026-07-16
source_of_truth: package.json + web/package.json + .env.example + web/.env.example

# 개발자 온보딩

## 1. 시작 전에

현재 릴리스 판정은 **HOLD**다. 로컬 개발과 검증은 가능하지만 이 문서의 명령은 push, 배포, 원격 DB 변경, EAS 작업, secret 교체를 승인하지 않는다.

먼저 다음 순서로 읽는다.

1. 루트 [`AGENTS.md`](../../AGENTS.md)
2. [`INDEX.md`](./INDEX.md)와 변경 영역의 owning handbook
3. [`.claude/WORK_LOG.md`](../../.claude/WORK_LOG.md)의 최신 항목
4. 현재 branch/HEAD와 관련 diff

## 2. 필수 도구

| 도구 | 용도 | 확인 |
| --- | --- | --- |
| Git | 변경 추적 | `git --version` |
| Node.js 24 + npm | root/web 실행·검증. `web/package.json`의 engine과 맞춘다 | `node --version`, `npm --version` |
| Expo CLI (`npx`) | 모바일 개발 서버와 local web export | `npx expo --version` |
| Deno | Supabase Edge Function 정적 검사 | `deno --version` |
| Docker Desktop | 폐기 가능한 Supabase local stack | `docker info` |
| Supabase CLI | local stack/status/lint. 원격 명령은 승인 대상 | `supabase --version` |
| Vercel CLI | local production-shape build 입력 확인. 배포는 승인 대상 | `vercel --version` |

GitHub, Supabase, Vercel, Sentry 같은 외부 서비스 작업은 해당 Codex plugin을 먼저 사용한다.

## 3. 설치

PowerShell에서 저장소 루트와 admin web 의존성을 각각 설치한다.

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
npm ci
Push-Location web
npm ci
Pop-Location
```

`npm ci`는 추적된 lockfile을 그대로 재현하는 기본 설치 경로다. 의존성 유지보수에서만 `npm install`로 lockfile을 의도적으로 갱신하고, manifest/lock diff와 감사 결과를 함께 검토한다. 설치가 예상 밖으로 lockfile을 바꿨다면 즉시 중지하고 원인을 확인하며 관련 없는 변경은 stage하지 않는다.

## 4. 환경변수 이름

실제 값은 비밀 저장소 또는 승인된 개인 환경에서 주입한다. 채팅, 로그, 문서, 테스트 영수증에 값을 복사하지 않는다.

### Root / Expo

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_INVITE_BASE_URL`
- `EXPO_PUBLIC_ADMIN_WEB_URL`
- `EXPO_PUBLIC_APP_STORE_URL`
- `EXPO_PUBLIC_REQUEST_BOARD_URL`
- `EXPO_PUBLIC_REQUEST_BOARD_API_URL`
- `EXPO_PUBLIC_REQUEST_BOARD_WEB_URL`
- `EXPO_PUBLIC_REQUEST_BOARD_USE_LOCAL_DEV`
- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_SENTRY_ENVIRONMENT`
- `EXPO_PUBLIC_SENTRY_RELEASE`

### Admin web / server

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FC_APP_SESSION_TOKEN_SECRET`
- `FC_APP_SESSION_TOKEN_PREVIOUS_SECRET`
- `REQUEST_BOARD_NOTIFY_TOKEN`
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `ADMIN_PUSH_SECRET`
- `NEXT_PUBLIC_REQUEST_BOARD_URL`

### Edge·bridge·운영

- `SUPABASE_URL`
- `REQUEST_BOARD_AUTH_BRIDGE_SECRET`
- `REQUEST_BOARD_PASSWORD_SYNC_URL`
- `REQUEST_BOARD_PASSWORD_SYNC_TOKEN`
- `BOARD_AUTOMATION_TOKEN`
- `BOARD_AUTOMATION_ACTOR_PHONE`
- `BOARD_AUTOMATION_ACTOR_NAME`
- `ADMIN_WEB_URL`

### Sentry

- `SENTRY_READ_AUTH_TOKEN`: issue/event/release 등 읽기 전용 조사에만 사용한다.
- `SENTRY_AUTH_TOKEN`: release/source-map upload 전용이다. 읽기 fallback으로 사용하지 않는다.
- `SENTRY_DISABLE_AUTO_UPLOAD`
- `SENTRY_DISABLE_UPLOAD`
- `SENTRY_URL`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

tracked example은 이름과 placeholder만 둔다. `.env`, `.env.local`, token, project credential은 commit하지 않는다.

## 5. 로컬 실행

### Expo 앱

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
npm start
```

별도 터미널에서 승인된 emulator/device가 있을 때만 `npm run android` 또는 `npm run ios`를 실행한다. EAS 명령은 local run이 아니다.

### Admin web

```powershell
Set-Location D:\hanhwa\fc-onboarding-app\web
npm run dev
```

### Supabase local

```powershell
docker info
supabase start
supabase status
```

Docker daemon이 꺼져 있으면 환경 차단으로 기록한다. 원격 프로젝트로 대체하지 않는다. `supabase db reset`은 현재 CLI가 local stack을 가리키고 테스트 데이터가 폐기 가능함을 확인한 뒤에만 사용한다.

## 6. 안전한 테스트 데이터

- local Supabase 또는 명시된 staging 전용 계정만 사용한다.
- 이름, 전화번호, 주민번호, 고객 문서, 실제 첨부를 fixture로 복사하지 않는다.
- synthetic identity는 `TEST_FC_A`, `TEST_MANAGER_A`처럼 사람을 식별하지 않는 label과 예약된 placeholder를 사용한다.
- 각 테스트는 생성 row/object와 정리 절차를 함께 가진다. 정리되지 않는 `test:api`류 명령은 공유·운영 DB에서 실행하지 않는다.
- 백업 비교는 schema, row count, 안정적 비식별 hash만 사용한다.

## 7. 첫 안전 검증

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
git diff --check
node scripts/ci/documentation-governance.test.mjs
node scripts/ci/check-governance.mjs
npm run lint
npx tsc --noEmit
npm test -- --runInBand
```

Edge Function은 원격 배포 대신 frozen Deno check와 local handler smoke를 사용한다. 예:

```powershell
deno check --frozen --config supabase/functions/deno.json supabase/functions/fc-notify/index.ts
```

### 업로드가 차단된 build

모든 build 전에 현재 프로세스에만 아래 값을 주입한다.

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'

npm run build
Push-Location web
npm run build
Pop-Location
```

이 설정에도 Sentry upload, release 생성, artifact mutation이 보이면 build를 실패로 분류하고 중단한다.

## 8. 현재 기대되는 결과

- 전체 추적 Edge Function 진입점: Deno 46/46, 진단 0건.
- 전체 admin web TypeScript, root/web clean install·build, root/web full/production audit: PASS, audit advisory 0건.
- 인증 browser E2E와 원격 migration/caller rollout: 아직 증거가 없어 차단 상태다.
- 따라서 focused gate가 통과해도 전체 릴리스 판정은 `HOLD`다.

## 9. 문제 해결

### Docker 또는 Supabase local이 시작되지 않음

1. `docker info`가 daemon에 연결되는지 확인한다.
2. `supabase status`로 local container 상태만 확인한다.
3. port 충돌을 해소한 뒤 다시 시작한다.
4. 계속 실패하면 `ENVIRONMENT_BLOCKED`로 기록하고 원격 DB를 대체재로 사용하지 않는다.

### Deno import/cache 오류

- 저장소의 `supabase/functions/deno.json`과 lockfile을 그대로 사용한다.
- `--frozen` 오류를 숨기려고 lockfile을 임의 갱신하거나 검사 범위를 줄이지 않는다.
- changed-entrypoint 결과와 전체 함수 결과를 별도로 기록한다.

### 환경변수 오류

- 필요한 **이름**이 example에 있는지 확인한다.
- 값은 출력하지 말고 `defined/missing`, 길이 범주, 비식별 fingerprint 여부만 진단한다.
- app-session current/previous key와 bridge secret은 서로 다른 trust domain이다.

### Sentry 오류

- 읽기 조사는 Sentry plugin과 `SENTRY_READ_AUTH_TOKEN`만 사용한다.
- local build는 네 가지 업로드 차단 환경변수를 모두 설정한다.
- 인증·scope·source map 차단은 제품 오류와 분리해 `EXTERNAL_CREDENTIAL` 또는 `ENVIRONMENT_BLOCKED`로 기록한다.

## 10. 다음 문서

- 운영: [`operations-runbook.md`](./operations-runbook.md)
- 변경 체크: [`change-checklist.md`](./change-checklist.md)
- 배포와 롤백: [`../deployment/DEPLOYMENT.md`](../deployment/DEPLOYMENT.md)
- 명령 안전 등급: [`../guides/COMMANDS.md`](../guides/COMMANDS.md)
