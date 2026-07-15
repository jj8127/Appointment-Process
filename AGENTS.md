# AGENTS.md

## 역할

이 파일은 `fc-onboarding-app` 작업의 빠른 제어 문서다. 누적 구현 이력과 장기 로드맵은 두지 않는다.

- 현재 동작의 SSOT: [`docs/handbook/INDEX.md`](./docs/handbook/INDEX.md)
- 교차 저장소 계약: [`docs/handbook/shared/`](./docs/handbook/shared/)
- 작업 이력과 검증: [`.claude/WORK_LOG.md`](./.claude/WORK_LOG.md), [`.claude/WORK_DETAIL.md`](./.claude/WORK_DETAIL.md)
- 반복 실수: [`.claude/MISTAKES.md`](./.claude/MISTAKES.md)
- 2026 감사와 백로그: [`../codex-toolkit/portfolio/2026/architecture-techdebt-security-test-audit.md`](../codex-toolkit/portfolio/2026/architecture-techdebt-security-test-audit.md), [`../codex-toolkit/portfolio/2026/backlog.xlsx`](../codex-toolkit/portfolio/2026/backlog.xlsx)

## 현재 릴리스 판정

**릴리스 HOLD**

- 로컬 보안 변경은 `75b1a0a`와 `a12928b`에 분리돼 있고, changed Edge Deno 검증은 18/18 진입점에서 진단 0건이다.
- 전체 web TypeScript gate는 기존 테스트 import/type 부채로 실패한다. focused 보안 경로 통과를 전체 gate 녹색으로 해석하지 않는다.
- signed caller 채택 뒤 Edge auth enforcement를 했다는 원격 증거와, 별도 RPC migration 뒤 caller 활성화를 했다는 원격 증거가 모두 없다. 실제 인증 계정 E2E도 없다.
- active tracked editor 설정에 live-looking token-like secret이 남아 있다. 값·접두사·해시는 읽거나 문서에 복사하지 말고, 외부 소유자가 revoke/rotate와 history/clone 영향 평가를 완료해야 한다.
- 위 차단점과 포트폴리오 감사의 P0/Critical·High 항목이 닫히기 전 HOLD를 해제하지 않는다.

## 프로젝트와 역할 경계

- `가람in`: 이 저장소의 Expo/Next/Supabase 기반 FC 위촉·온보딩·운영 시스템.
- `가람Link`: `request_board`의 사용자 노출 서비스명. `request_board`는 기술 저장소명이다.
- `fc`: 본인 온보딩과 설계요청 생성 주체.
- `manager`: FC 리더. admin/ops surface에서는 읽기 전용이고 FC-equivalent self-service 경로만 사용한다.
- `admin`: 총무/운영 쓰기 주체.
- `developer`: `admin_accounts.staff_type='developer'`인 admin subtype. 표시 identity와 Request Board bridge 정규화 규칙을 보존한다.
- `designer`: 가람Link에서 설계요청을 처리하는 보험사 설계 매니저.

## 시작 순서

1. 루트와 대상 하위 디렉터리의 `AGENTS.md`를 읽는다.
2. [`docs/handbook/INDEX.md`](./docs/handbook/INDEX.md)에서 owning 문서를 찾는다.
3. [`.claude/WORK_LOG.md`](./.claude/WORK_LOG.md)의 최신 항목과 필요한 상세 앵커만 읽는다.
4. `git status --short`, 현재 branch/HEAD, 관련 diff를 확인한다. 기존 dirty hunk를 사용자 작업으로 취급한다.
5. 동작 변경이면 `path-owner-map.json`과 `contract-test-map.json`에 맞는 증거를 먼저 정한다.

## 작업 안전 규칙

- stash/reset/checkout, `git add -A`, 자동 수정 lint/formatter를 사용하지 않는다.
- 기존 dirty hunk를 덮어쓰거나 설명할 수 없는 변경을 stage하지 않는다.
- push, PR, 실제 배포, 원격 DB 변경, secret 설정·교체, Sentry mutation은 명시적 승인 없이는 수행하지 않는다.
- 운영/공유 DB에서 계정을 만들거나 정리하지 않는 파괴적 테스트를 실행하지 않는다.
- migration과 schema 변경은 `supabase/schema.sql`과 `supabase/migrations/*.sql`을 함께 갱신한다.
- 기능 변경은 code, owning handbook, WORK_LOG/DETAIL을 함께 맞춘다. 반복 가능한 회귀·계약 드리프트면 MISTAKES도 갱신한다.

## 외부 서비스와 플러그인 라우팅

- 외부 서비스 작업 전 일치하는 Codex plugin/app/skill을 먼저 확인한다.
- Sentry 작업은 Sentry plugin을 사용한다. 읽기는 `SENTRY_READ_AUTH_TOKEN`만 사용하고 `SENTRY_AUTH_TOKEN`으로 fallback하지 않는다.
- GitHub, Supabase, Vercel 작업은 각각 해당 plugin을 사용한다.
- 정확한 connector가 있으나 설치되지 않았다면 설치를 요청한 뒤 진행한다.
- 모든 최종 답변에 `도구/스킬 검토`를 넣어 Superpowers, Sequential Thinking, context7 사용 또는 검토 여부와 이유를 짧게 밝힌다.

## 로컬 검증 안전 경계

모든 build 예시는 source-map/release 업로드를 차단한다. PowerShell에서 먼저 다음 값을 현재 프로세스에만 설정한다.

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = 'local-verification-disabled'
$env:SENTRY_URL = 'http://127.0.0.1:9'
```

안전한 기본 검증:

```powershell
git diff --check
node scripts/ci/check-governance.mjs
npm run lint
npx tsc --noEmit
npm test -- --runInBand
npm run test:coverage -- --runInBand
npm run build
Push-Location web
npm run lint
npx tsc --noEmit
npm run build
Pop-Location
```

- build 출력에 upload/release/artifact mutation이 보이면 즉시 실패로 분류한다.
- `npm audit fix`, Vercel deploy, Supabase push/functions deploy, EAS build/update/submit은 검증 명령이 아니다.
- Supabase Functions에는 진짜 원격 dry-run이 없으므로 Deno check와 loopback handler smoke를 사용한다.

## 릴리스 안전 계약

- `eas build`, `npm run eas:build:*`, store submit, 비용이 발생할 수 있는 native build는 현재 대화의 명시적 승인 없이 실행하지 않는다.
- 승인된 native build 전 `app.json`의 현재 버전과 제안 버전, platform/profile, 비용 영향 명령을 제시한다.
- `eas update`도 production runtime을 변경한다. 대상 branch/runtime과 설치 binary 호환성을 확인하고 별도 승인을 받는다.
- 모호한 “배포” 요청은 server-only, OTA, native build 중 범위를 확인한다.
- Vercel은 승인 전 local `vercel build --prod` 또는 입력 dry-run만 허용한다.
- 인증 enforcement와 DB RPC 전개를 별도 축으로 문서화한다. signed caller 채택은 Edge auth enforcement보다 먼저지만, RPC caller 활성화는 해당 additive migration의 적용·검증보다 뒤다.

## 보안 불변식

1. 주민번호 평문을 DB, 로그, local storage, 보고서에 저장하지 않는다. full-view는 trusted server/secure path와 signed 현재 범위에서만 허용한다.
2. admin 쓰기는 trusted server path 또는 service-role Edge 경계를 통과해야 한다. anon client privileged write를 추가하지 않는다.
3. app session은 전용 current/previous HMAC key만 사용한다. Request Board bridge secret을 signer/verifier fallback으로 재사용하지 않는다.
4. body의 role, actor, phone, sender identity를 권한 근거로 사용하지 않는다. signed session을 활성 DB actor에 다시 결합한다.
5. JWT, 전화번호, 주민번호, token, raw upstream body/error를 로그·Sentry·테스트 영수증에 남기지 않는다.
6. `manager`는 admin/ops write 권한을 얻지 않는다.
7. 상태 문자열과 Edge response 계약(`ok`, `message`)을 변경하려면 coordinated migration과 contract test가 필요하다.

## Board·알림·원자성 계약

- 모바일 Board/FC notify caller는 request-bound signed app-session을 보낸다. session이 없으면 네트워크 전에 실패한다.
- admin web은 signed same-origin server proxy와 HttpOnly session을 사용한다. 브라우저에서 service-role Function을 직접 호출하지 않는다.
- Request Board notification ingress는 paired exact secret, 허용 action, 길이 제한, redaction을 모두 통과해야 한다.
- 보험 브리핑 automation은 category/list 조회와 canonical `general` 글 생성만 허용하며 현재는 token 복구와 수동 E2E 전까지 중지한다.
- Board post/attachment와 exam save는 제공된 atomic RPC/DB cascade를 사용한다. 여러 문장 write로 되돌리지 않는다.
- **인증 축**: signed mobile/web/runner caller 배포 → 채택·재로그인 관측 → FC notify와 17개 Board Edge auth enforcement. DB migration을 이 축의 “caller-first”로 부르지 않는다.
- **DB 원자 RPC 축**: old/new DB 호환 caller 또는 기능 비활성 상태 → additive RPC migration 적용·검증 → 새 RPC caller 활성화 → 관측/auth smoke 후 legacy·compat 제거.
- `board-update` 새 handler는 Board RPC migration 검증 전 배포하지 않는다. auth caller 채택과 migration 검증을 모두 만족한 뒤 17개 Board enforcement 창에서 활성화한다.
- admin-web exam schedule의 새 RPC action은 exam RPC migration 검증 뒤 별도 web release로 활성화한다. 현재 RPC-required local artifact는 migration 전 호환 caller로 간주하지 않는다.

## 구현 규칙

- TypeScript strictness를 유지하고 `unknown`을 안전하게 좁힌다. 광범위한 `any`를 추가하지 않는다.
- `lib/*`, `components/*`, `hooks/*`의 기존 공용 모듈을 우선 사용한다.
- 읽기는 TanStack Query `useQuery`, 쓰기는 `useMutation`과 명시적 invalidation 패턴을 따른다.
- Expo Router와 Next App Router의 현재 경로/파일 convention을 유지한다.
- 역할·상태·브리지·민감정보 변경은 targeted negative test와 owning handbook를 함께 갱신한다.
- 설명 가능한 경로만 선택적으로 stage하고 conventional commit을 사용한다.

## 종료 체크리스트

1. 수용 기준과 관련된 targeted test, governance, `git diff --check`를 실행한다.
2. 실패를 제품 결함, 테스트 부채, 환경 차단, 외부 자격증명, 파괴적 테스트 차단으로 분류한다.
3. WORK_LOG에는 한 줄 요약과 WORK_DETAIL 앵커를, WORK_DETAIL에는 명령·결과·미수행 경계를 남긴다.
4. 반복 실수일 때만 MISTAKES에 root cause와 영구 guardrail을 추가한다.
5. 배포·DB·Sentry·credential state를 바꾸지 않았다면 명시한다.
6. 미해결 P0 또는 authenticated E2E 공백이 있으면 `릴리스 HOLD`를 유지한다.

## Context Map

- [문서 운영 계약](./docs/handbook/shared/documentation-contract.md): SSOT 순서, 갱신 범위, AGENTS 크기 규칙.
- [개발자 온보딩](./docs/handbook/developer-onboarding.md): 도구, 설치, 로컬 실행, 첫 검증, 문제 해결.
- [운영 런북](./docs/handbook/operations-runbook.md): health signal, 장애 분류, Sentry, rollback/escalation.
- [배포 체크리스트](./docs/deployment/DEPLOYMENT.md): lane별 gate, rollout, smoke, rollback.
- [Referral SSOT](./docs/referral-system/AGENTS.md): referral code, invite, attribution, incidents.
- [Mobile routes](./app/AGENTS.md), [shared components](./components/AGENTS.md), [hooks](./hooks/AGENTS.md).
- [Admin web](./web/AGENTS.md), [Supabase](./supabase/AGENTS.md), [Edge Functions](./supabase/functions/AGENTS.md).
