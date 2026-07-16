doc_id: FC-HANDBOOK-OPS-RUNBOOK
owner_repo: fc-onboarding-app
owner_area: handbook
audience: operator
last_verified: 2026-07-16
source_of_truth: web/src/app/api/* + supabase/functions/* + scripts/ops/*

# 운영 런북

## 현재 판정

**릴리스 HOLD**

- 최신 로컬 전체 영수증 `quality-full-20260716-015916`은 FC 18/18을 통과했다.
- 전체 Edge Deno는 46/46이고 root·web TypeScript, lint, Jest·coverage, Expo/web build, Node·ops·Board smoke, Sentry dry-run, root·web audit가 모두 PASS다.
- web Node suite의 1개 skip은 실제 Supabase 데이터와 외부 자격증명이 필요한 `referral-graph-realdata`다. 공유·운영 데이터를 대상으로 실행하지 않았으며 `DESTRUCTIVE_OR_EXTERNAL_TEST_BLOCKER`로 분류한다.
- signed caller 채택 뒤 Edge auth enforcement를 했다는 원격 증거와, 별도 RPC migration 뒤 caller 활성화를 했다는 원격 증거가 없다. 실제 인증 계정 E2E도 없다.
- credential 상태는 active tracked copy 0, 현재 local untracked copy 6, 과거 tracked 노출 확인이다. 승인된 로컬 정리와 외부 revoke/rotate·history/clone 영향 평가 전까지 P0다. 값·접두사·해시는 복사하지 않는다.

focused 검증 통과를 서비스 전체 healthy 또는 release-ready로 보고하지 않는다.

## 빠른 라우팅

- bridge/session: [`shared/cross-repo-bridge-contract.md`](./shared/cross-repo-bridge-contract.md)
- secret/PII: [`shared/security-and-secret-operations.md`](./shared/security-and-secret-operations.md)
- admin workflow: [`admin-web/dashboard-lifecycle.md`](./admin-web/dashboard-lifecycle.md)
- Board/notice: [`backend/board-api-and-notice-model.md`](./backend/board-api-and-notice-model.md)
- notification/push: [`backend/notifications-inbox-push.md`](./backend/notifications-inbox-push.md)
- data canon: [`data/data-model-canon.md`](./data/data-model-canon.md)
- release/rollback: [`../deployment/DEPLOYMENT.md`](../deployment/DEPLOYMENT.md)

## 서비스 신호

단일 canonical DB health endpoint는 없다. 한 endpoint의 200 또는 한 화면 렌더만으로 전체 서비스를 정상 판정하지 않는다.

| 영역 | 최소 신호 | 의미하지 않는 것 |
| --- | --- | --- |
| Expo 앱 | cold start, signed login, 현재 role의 첫 화면 | Edge/DB write 전체 정상 |
| Admin web | `/auth` 렌더와 signed protected route 진입 | manager/admin write parity 전체 정상 |
| Session | app-session 발급·복원, 활성 DB actor 재결합 | Request Board bridge까지 자동 정상 |
| Bridge | 가람Link login/session sync, 정확한 role 정규화 | FC app-session key가 bridge key와 같아도 됨 |
| Board | list/detail/create/update와 loopback smoke | 원격 migration/17개 Function rollout 완료 |
| Exam | save RPC와 post-commit notification 분리 | 실제 원격 RPC 존재 또는 알림 delivery 보장 |
| Notification | inbox row, push fanout, deep link 각각 확인 | 한 채널 성공이 다른 채널 성공 |
| DB | schema/migration parity, local query/RPC smoke | production DB healthy 전체 판정 |
| Sentry | read-only issue/event 조회 | 최근 issue 0건이 backlog 0건 또는 서비스 정상 |

health 보고에는 관측 시간, 환경, caller role, 실행 명령, 종료코드, 미검증 영역을 함께 적는다.

## 장애 분류

| 등급 | 예시 | 첫 조치 | 에스컬레이션 |
| --- | --- | --- | --- |
| P0 | auth bypass, secret 노출, 주민번호/JWT 로그, 데이터 손실·비원자 partial write | mutation 중지, 릴리스/자동화 중지, 증거 비식별 보존 | security owner + service owner 즉시 |
| P1 | signed session/bridge 장애, 다수 사용자 로그인·Board·시험 차단, migration/caller mismatch | 영향 lane 격리, last-known-good client/contract 확인 | service owner와 운영 담당 |
| P2 | 일부 role/UI/notification channel 오류, retry 가능한 실패 | last-good 데이터 유지, 재현과 범위 수집 | owning team 업무시간 내 |
| P3 | 문서·관측·개발 도구 부채 | backlog와 수용 기준 기록 | 정기 품질 검토 |

원인을 제품 결함, 테스트 부채, 환경 차단, 외부 자격증명, 파괴적 테스트 차단 중 하나 이상으로 표시한다.

## 초기 대응 순서

1. 새 배포, migration, EAS, 자동 게시, credential 변경을 멈춘다.
2. 시간대, 환경, 영향 role/surface, last-known-good commit을 기록한다.
3. raw 로그를 복사하지 말고 request id, status, action class, 비식별 count만 수집한다.
4. signed-session → 활성 DB actor → owning RPC/Function → notification side effect 순서로 경계를 좁힌다.
5. 읽기 전용·local·loopback 재현을 먼저 사용한다. 공유/운영 DB에 합성 계정을 만들지 않는다.
6. rollback 또는 forward correction을 선택하고 승인자를 기록한다.
7. smoke와 관측 창을 통과할 때까지 HOLD를 유지한다.

## 민감정보와 로그

다음은 application log, browser console, Sentry context, 테스트 영수증, 보고서에 남기지 않는다.

- 주민번호 전체/부분값
- 전화번호와 실제 이름
- JWT, app-session, bridge token, API key, cookie, authorization header
- password/hash/salt, OTP, service-role key
- raw upstream response body 또는 raw `Error.message` 중 위 항목을 포함할 수 있는 값

허용되는 진단은 action 이름, HTTP status, coarse error class, boolean flag, row count, 안정적 비식별 correlation id다. redaction은 자르기 전에 전체 문자열에 먼저 적용한다.

## Sentry 조사

- Sentry plugin을 사용한다.
- API 읽기는 `SENTRY_READ_AUTH_TOKEN`만 사용한다. `SENTRY_AUTH_TOKEN`은 source-map/release upload용이며 읽기 fallback 금지다.
- 기본 24시간 issue 0건은 7일/전체 unresolved backlog 0건을 뜻하지 않는다.
- issue/event에서 PII/JWT/raw request body를 다시 문서에 복사하지 않는다.
- local production-shape build에는 다음 네 가지 차단값을 모두 주입한다.

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

upload/release/artifact mutation 흔적이 있으면 build는 실패다. live Sentry 상태 변경이나 issue resolve는 별도 승인 없이는 금지한다.

## Signed session과 bridge secret

| 경계 | local 이름 | paired 상대 | 규칙 |
| --- | --- | --- | --- |
| FC app session | `FC_APP_SESSION_TOKEN_SECRET`, `FC_APP_SESSION_TOKEN_PREVIOUS_SECRET` | 동일 trust domain의 current/previous | bridge secret fallback 금지 |
| Request Board auth bridge | `REQUEST_BOARD_AUTH_BRIDGE_SECRET` | `FC_ONBOARDING_AUTH_BRIDGE_SECRET` | exact pair, app-session signer로 재사용 금지 |
| Password sync | `REQUEST_BOARD_PASSWORD_SYNC_TOKEN` | `FC_ONBOARDING_PASSWORD_SYNC_TOKEN` | exact pair, fail closed |
| Notification ingress | `REQUEST_BOARD_NOTIFY_TOKEN` | `FC_ONBOARDING_NOTIFY_TOKEN` | exact pair, constant-time compare, allowlist |
| Board automation | `BOARD_AUTOMATION_TOKEN` | Edge secret과 exact pair | canonical digest 최소 권한만 |

body의 actor/role/phone/sender는 권한 근거가 아니다. signed claim을 활성 DB row에 다시 결합하고, caller-controlled forwarding header를 origin authority로 사용하지 않는다.

rotation은 새 current → old current를 previous → 최대 token TTL 경과 → previous 제거 순서다. bridge key를 임시 app-session fallback으로 넣지 않는다.

## Board·시험 원자성

- Board update는 additive `update_board_post_atomic` RPC가 먼저 존재해야 한다.
- attachment finalize는 actor/post ownership, canonical object path, object existence, 실제 size/MIME, 개수 제한을 서버에서 재검증한다.
- exam round save는 atomic RPC를 사용하고, delete는 검증된 FK cascade를 사용하는 단일 parent delete다.
- post-commit notification 실패는 committed DB write를 실패로 재분류하지 않는다.
- RPC가 없으면 caller는 fail closed한다. multi-statement write로 되돌리는 rollback은 금지한다.
- 현재 local `board-update` handler와 admin-web exam schedule action은 RPC-required이므로 migration 전 호환 caller가 아니다. 원격 RPC 검증 전에는 해당 artifact를 배포하지 않거나 기능을 비활성 상태로 유지한다.

## 보험소식 브리핑

현재 자동 게시 상태는 **PAUSED**다.

- 2026-07-16 read-only 확인에서 이 fallback을 실행하는 Windows Scheduled Task는 0개였다. 스케줄러 상태를 생성·수정·활성화하지 않았다.
- fallback은 설치된 Codex의 기본 모델을 사용한다. 모델 pin을 다시 넣지 않으며 ops regression test로 이를 고정한다.
- 재개 게이트: `BOARD_AUTOMATION_TOKEN` pair 복구, 활성 admin actor 확인, local/staging manual E2E, category/list/create 최소 권한 확인.
- 허용 action: `board-categories-list`, `board-list`, canonical `general`의 `board-create`.
- category 생성/수정, post 수정/삭제, attachment action은 금지한다.
- title은 canonical 보험 브리핑 형식을 사용하고, 본문에는 raw URL·비밀값·개인정보를 넣지 않는다.
- 재개 전에는 `--dry-run` 또는 `--check-existing`도 credential/환경 차단을 보고하는 용도로만 사용하고 게시 성공을 가정하지 않는다.
- token과 수동 E2E가 복구되기 전 스케줄러를 활성화하지 않는다.

## 자동화 정책

- 신규 스케줄은 report-only다. 코드 수정, commit, push, PR, 배포, migration, 게시, Sentry mutation을 수행하지 않는다.
- 주간 품질 보고는 새 실패·gate 변화·차단점만 요약한다.
- 월간 로드맵 보고는 포트폴리오 risk/backlog 변화를 제안하되 원본을 자동으로 덮어쓰지 않는다.
- credential 부재나 scope 부족은 실패를 숨기지 않고 `EXTERNAL_CREDENTIAL`로 보고한다.
- 기존 보험 다이제스트 자동화는 위 재개 게이트 전까지 비활성 상태를 유지한다.

## 롤백과 forward correction

### 인증 enforcement 축

1. signed mobile/web/runner caller를 먼저 반영한다.
2. token 채택, same-origin proxy, 강제 재로그인 영향을 관측한다.
3. FC notify와 17개 Board Function의 auth enforcement를 같은 통제 창에서 적용한다.
4. role별 allow/deny와 active actor binding을 smoke한다.

이 순서는 인증 경계만 설명한다. DB migration을 “caller-first” 단계에 섞지 않는다. body actor fallback이나 bridge-key app-session fallback은 rollback이 아니다.

### DB 원자 RPC 축

1. **A 호환/비활성 caller**: old/new DB 모두 안전한 caller를 먼저 두거나 새 RPC 기능을 비활성화한다. 현재 RPC-required `board-update`와 exam schedule artifact는 A로 배포하지 않는다.
2. **B additive migration**: Board와 Exam migration을 각각 적용하고 RPC 존재, 권한, atomic failure를 검증한다.
3. **C RPC 활성화**:
   - `board-update`는 Board migration 검증과 signed caller 채택을 모두 충족한 뒤 17개 Board auth enforcement 창에서 활성화한다.
   - admin-web exam schedule은 Exam migration 검증 뒤 별도 web release에서 활성화한다.
4. **D 관측/정리**: partial-write 0건, RPC error, 인증 allow/deny를 관측한 후에만 feature flag·legacy artifact·capability compat를 제거한다.

적용 전 migration list, schema diff, backup/restore 책임자와 관측 query를 확인한다. 이미 적용된 migration 파일은 수정하지 않고 destructive down migration 대신 additive forward correction을 사용한다. 원격 적용에는 명시적 승인과 폐기 가능한 검증 경로가 필요하다.

### Web/Expo/native

- web은 last-known-good artifact와 env compatibility를 확인한다.
- Expo OTA와 native build를 구분한다. native rollback은 binary/version/store 제약을 포함한다.
- EAS build/update/submit과 Vercel deploy는 승인 없이는 실행하지 않는다.

### Credential incident

- 값을 채팅·티켓·보고서에 복사하지 않는다.
- 외부 owner가 revoke/rotate하고, active config 제거와 Git history/clone 영향 범위를 판정한다.
- non-sensitive revoke 증거와 scanner zero-result만 인수인계한다.

## 종료와 인수인계

다음이 모두 있어야 장애를 종료한다.

- root cause와 영향 범위
- 안전한 재현 또는 관측 증거
- 수정 commit/migration/설정 변경의 소유자
- 실행한 smoke와 종료코드
- 미검증 role/surface
- rollback 또는 forward correction 결과
- PII/secret이 없는 영수증

P0/Critical·High, authenticated E2E, remote rollout, credential incident 대응 중 하나라도 남으면 결론은 계속 **릴리스 HOLD**다. 현재 root·web TypeScript gate는 PASS지만 외부 차단을 대신하지 않는다.
