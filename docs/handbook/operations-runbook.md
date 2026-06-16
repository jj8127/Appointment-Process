doc_id: FC-HANDBOOK-OPS-RUNBOOK
owner_repo: fc-onboarding-app
owner_area: handbook
audience: operator
last_verified: 2026-05-18
source_of_truth: web/src/app/api/* + supabase/functions/* + data/*

# 운영 런북

## 자주 찾는 작업

- 로그인/세션/브리지 장애: [shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- 비밀번호/SMS/테스트 코드: [shared/security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)
- FC 상태 복구: [admin-web/dashboard-lifecycle.md](E:/hanhwa/fc-onboarding-app/docs/handbook/admin-web/dashboard-lifecycle.md)
- resident number 조회: [backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
- 알림/푸시/배지: [backend/notifications-inbox-push.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/notifications-inbox-push.md)
- referral 운영: [data/referral-schema-and-admin-rpcs.md](E:/hanhwa/fc-onboarding-app/docs/handbook/data/referral-schema-and-admin-rpcs.md)

## Codex 자동 보험소식 브리핑

- 권장 payload 경로: `.codex-tmp/insurance-digest/YYYY-MM-DD.json`
- 실행 명령: `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/YYYY-MM-DD.json`
- dry-run: `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/YYYY-MM-DD.json --dry-run`
- 필수 환경변수:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `BOARD_AUTOMATION_ACTOR_ROLE=admin`
  - `BOARD_AUTOMATION_ACTOR_PHONE`
  - `BOARD_AUTOMATION_ACTOR_NAME`
- 스크립트는 위 값이 process env에 없으면 repo `.env` / `.env.local`을 읽고 `NEXT_PUBLIC_SUPABASE_*` 또는 `EXPO_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_ADMIN_PHONES` 또는 `EXPO_PUBLIC_ADMIN_PHONES`에서 fallback을 구성한다.
- 게시판 글 종류는 고정 5종 중 `일반`(`general`)을 사용한다. 없으면 스크립트가 admin actor로 생성한다.
- 정기 자동화는 매주 월요일에 지난주 월요일~일요일(KST) 보험 이슈를 정리해 게시한다.
- 같은 KST 날짜의 `보험소식 브리핑 YYYY.MM.DD` 제목이 이미 있으면 게시를 건너뛴다.
- 게시는 기존 `board-create` Edge Function을 통해 수행하므로 게시판 알림/푸시 fanout 계약을 우회하지 않는다.
- digest는 아주 짧고 쉬운 문장으로 작성하며, `sourceUrls`에 최소 1개 이상의 `http/https` 출처가 없으면 스크립트가 게시를 거부한다.
- 게시글 본문에는 긴 원문 URL을 붙이지 않는다. 본문에는 `출처: 금융감독원`, `출처: 데일리안`처럼 짧은 출처명만 쓰고, 원문 URL은 JSON `sourceUrls`에 넣는다.
- 가능하면 `sourceLabels`도 함께 넣어 짧은 언론사/기관/기사 라벨을 남긴다.
- 게시글 끝에는 AI 참고용/비자문 고지 문구를 붙이지 않는다.
- Codex automation runner가 shell 실행 실패를 반환하면 게시 성공으로 간주하지 않는다. 이 경우 정상 로컬 터미널에서 같은 payload 파일로 수동 실행한다.
- 2026-06-05 기준, Codex 앱 cron은 매주 월요일 11:00 KST에 맞춘다. Windows Task Scheduler 백업 작업 `GaramIn Insurance Digest Codex Fallback`은 필요 시 같은 요일 11:05 KST에 맞춘다.
- 백업 실행기는 `scripts/ops/run-insurance-digest-codex.ps1`이며, Codex CLI로 같은 게시/검증 절차를 수행한다. 실행 결과는 `.codex-tmp/insurance-digest/codex-cli-YYYY-MM-DD.*`에 남긴다.
- 월요일 11:30 KST 이후에도 오늘 게시글이 없으면 `.codex-tmp/insurance-digest/YYYY-MM-DD.json`을 만들고 위 실행 명령으로 수동 복구한다.
- 게시 후에는 `/board?postId=...` 게시판 상세 모달과 FC/admin `inbox_list`를 확인한다. 특히 알림 row가 비면 `fc-notify notify`로 보강하고 원격 `notifications_recipient_role_check` migration 적용 여부를 확인한다.

## 필수 점검 순서

1. 역할/권한 계약이 맞는지 확인합니다.
2. 해당 상태 전이가 어느 저장소 소유인지 확인합니다.
3. 관련 migration/secret/bucket 선행 조건을 확인합니다.
4. 사용자 노출 동작과 운영 작업을 함께 검증합니다.

## 교차 저장소 smoke path

`로그인 또는 비밀번호 재설정 -> GaramLink bridge-login -> FC 요청 생성 -> designer accept/complete -> unread/notification sync`
## 2026-06-16 Codex cron automation contract

### Weekly insurance digest

- Codex automation name: `weekly-insurance-digest-to-garamin-board`.
- Schedule: every Monday at 11:00 KST. First planned run: 2026-06-22 11:00 KST for the 2026-06-15 through 2026-06-21 issue window.
- Workspace and execution: local run in `D:\hanhwa\fc-onboarding-app`.
- Preflight: run `npm run ops:post-insurance-digest -- --check-existing` before using Codex research/writing. Exit `0` means the same-day post exists and the automation should stop. Exit `2` means actor/category access worked but the post is missing, so the automation may research and post. Any other exit, especially `admin account not found`, is a blocker and must be reported as not posted.
- Actor contract: `BOARD_AUTOMATION_ACTOR_PHONE` must match an active row in `admin_accounts.phone` or `manager_accounts.phone` for the selected actor role. The public admin-phone fallback can be stale, so set this value explicitly when preflight returns `admin account not found`.
- Posting path: generate `.codex-tmp/insurance-digest/YYYY-MM-DD.json`, then run `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/YYYY-MM-DD.json`.
- Content contract: title `보험소식 브리핑 YYYY.MM.DD`, category `일반/general`, short Korean summary, visible source names only, no raw URLs in body, no AI/reference/disclaimer copy. JSON `sourceUrls` must contain at least one public `http/https` source URL.
- Verification after Monday 11:30 KST: confirm the board post exists, confirm `/board?postId=...` opens the board detail modal, and confirm FC/admin inbox rows target `/board?postId=...`. If inbox rows are missing, repair only missing notification rows through the existing `fc-notify` contract.

### Daily Sentry repair PR

- Codex automation name: `daily-sentry-repair-pr`.
- Schedule: every day at 11:00 KST.
- Workspace and execution: worktree run from `D:\hanhwa\fc-onboarding-app`, based on `origin/main`, so local dirty files such as `app.json` are not touched.
- Triage command: `npm run ops:sentry-triage`.
- Dry run: `npm run ops:sentry-triage -- --dry-run`.
- Sentry scope: org `hanhwa-lifelab`, projects `react-native` and `garamin-web`, production unresolved fatal/error issues. `garamin-web` was created on 2026-06-16 as a Next.js Sentry project in team `hanhwa-lifelab`.
- Token rule: Sentry reads must use `SENTRY_READ_AUTH_TOKEN` only. `SENTRY_AUTH_TOKEN` is release/source-map upload only and must not be used as a read fallback.
- Fix scope: choose one highest-priority fixable issue, or a tightly related root-cause group, then create a draft PR.
- PR branch: `codex/sentry-daily-YYYYMMDD-<issue-short-id>`.
- PR title: `fix(sentry): <issue short id> <short title>`.
- PR body must include Sentry issue link, latest event summary, root cause, changed files, verification commands, and the explicit note that production deploy/native build/EAS Update/Sentry resolve were not performed.
- Out of scope: native builds, EAS Update, Vercel production deploy, store submission, Sentry issue resolve/status mutation.
- If `SENTRY_READ_AUTH_TOKEN` is missing, Sentry returns insufficient scope, source maps are missing, the issue is already fixed locally but not deployed, or no safe code fix is available, the automation reports the blocker and does not open a PR.
