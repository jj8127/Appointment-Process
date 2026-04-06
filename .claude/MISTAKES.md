# 실수 기록 (Mistakes Only)

> 반복될 수 있는 실수, 회귀, 드리프트만 기록합니다.  
> 기능 완료 보고, 일반 변경 내역, TODO는 여기에 쓰지 않습니다.

## 기록 규칙

- 아래 경우에만 기록합니다.
  - 이미 고쳤다고 생각했던 동작이 다시 깨진 경우
  - 화면/route/function 사이 계약이 서로 달라져 사용자-visible 문제가 생긴 경우
  - 중복 구현 때문에 한 곳만 고치고 다른 곳이 다시 틀어진 경우
  - 검증 누락 때문에 같은 종류의 버그가 반복될 수 있는 경우
- 아래 내용은 기록하지 않습니다.
  - 신규 기능 추가
  - 단순 스타일 수정
  - 계획된 리팩터링 메모
  - 일반 작업 회고
- 버그 수정 세션이 위 조건에 해당하면 `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`와 별도로 이 파일도 같은 change set에서 갱신합니다.
- 항목은 최신순으로 맨 위에 추가합니다.

## 항목 형식

```md
## YYYY-MM-DD | Scope | Mistake
- Symptom:
- Root cause:
- Why it was missed:
- Permanent guardrail:
- Related files:
- Verification:
```

## 2026-04-06 | PR Checklist / Governance | 코드 거버넌스만 통과시키고 PR 템플릿 필수 체크리스트를 비워 둔 채 푸시함
- Symptom: 최신 PR governance run에서 path-owner-map 검사는 통과했지만 `Validate PR checklist` 단계가 실패했고, `PROJECT_GUIDE.md 확인`, `WORK_DETAIL 앵커 추가/업데이트`, `WORK_LOG 최근 작업 1행 추가/검토`, `스키마 변경 시 schema.sql + migrations 동시 반영`, `릴리즈/운영 영향(함수 배포·마이그레이션) 기재` 항목이 미체크로 남아 있었다.
- Root cause: repo의 governance를 `check-governance.mjs` 중심으로만 보고, PR body에 있는 별도 required checklist 검증까지 push 완료 조건에 포함하지 않았다.
- Why it was missed: GitHub Actions failure를 파일/코드 이슈로만 생각하는 관성이 남아 있었고, PR 본문을 마지막 완료물로 취급하지 않았다.
- Permanent guardrail: `git push` 뒤에는 `gh run view`로 workflow step 이름까지 확인하고, `Validate PR checklist`가 있는 repo에서는 PR body의 required checkbox를 같은 턴에 채운다. 코드/문서가 맞아도 PR template 미완성 상태면 "푸시 완료"로 보고하지 않는다. PR body를 뒤늦게 수정했으면 기존 `pull_request` run rerun만 믿지 말고, 새 `synchronize` 이벤트가 발생하도록 후속 커밋 또는 새 run 생성까지 확인한다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24032520698 --repo jj8127/Appointment-Process --log`, `gh pr view 1 --repo jj8127/Appointment-Process --json body`, `gh api repos/jj8127/Appointment-Process/pulls/1 --method PATCH --raw-field body=...`, `gh run rerun 24032520698 --repo jj8127/Appointment-Process`

## 2026-04-06 | CI Reporting / Run Selection | 성공한 최신 synchronize run이 있는데도 과거 rerun failure가 계속 보일 수 있다는 점을 충분히 분리해 설명하지 않음
- Symptom: 사용자는 `Governance Check #122` rerun failure 화면을 보고 여전히 PR이 깨졌다고 인식했고, 실제로는 최신 `pull_request synchronize` run `24032713335`가 `success`였다.
- Root cause: 제가 "현재 PR 기준 성공 run"과 "과거 SHA/attempt를 다시 돌린 rerun failure"를 명시적으로 분리해 설명하지 않았다.
- Why it was missed: workflow 하나가 green이면 상태가 정리됐다고 보고, GitHub UI에서 이전 run attempt가 별도로 빨갛게 남아 사용자 눈에 먼저 보일 수 있다는 운영 맥락을 과소평가했다.
- Permanent guardrail: CI 결과를 보고할 때는 항상 `run id`, `attempt`, `head sha`, `event`를 함께 적는다. 특히 rerun이 섞인 경우에는 "현재 PR head를 검증한 최신 synchronize run" 링크를 먼저 제시하고, 과거 rerun failure는 stale artifact라고 분명히 구분한다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24032520698 --repo jj8127/Appointment-Process --json attempt,headSha,conclusion,url`, `gh run view 24032713335 --repo jj8127/Appointment-Process --json attempt,headSha,conclusion,url`, `gh pr view 1 --repo jj8127/Appointment-Process --json body,updatedAt`

## 2026-04-06 | Commit Scope / Governance | PR 실패 원인으로 확인한 owner-map fix를 로컬에만 남기고 커밋 범위에서 제외한 채 푸시함
- Symptom: PR `Codex/referral rollout closeout` governance check가 다시 실패했고, 로그에는 여전히 `supabase/functions/invite/index.ts`, `supabase/functions/tsconfig.json`, `supabase/functions/validate-referral-code/index.ts` owner-map 누락이 그대로 나왔다.
- Root cause: 같은 세션에서 `docs/handbook/path-owner-map.json` 보강까지 해두고도, 이후 기능 커밋/푸시에서 "내가 방금 건드린 파일만" 선별한다는 이유로 그 fix를 제외했다. 결과적으로 PR 전체 diff 기준 blocker를 알고도 upstream에 보내지 못했다.
- Why it was missed: 장수 브랜치 debt와 현재 commit scope를 분리하겠다는 판단은 맞았지만, 이미 확인된 PR blocker는 예외 없이 같은 push batch에 포함해야 한다는 원칙을 다시 적용하지 않았다.
- Permanent guardrail: PR 실패 원인을 특정 파일 수준으로 확인한 뒤에는, 그 파일이 로컬 worktree에 남아 있으면 다음 push 전에 반드시 staged 여부를 다시 확인한다. `git diff -- <blocking-file>`와 `git diff --cached -- <blocking-file>` 둘 다 보고, blocker fix가 uncached 상태면 푸시하지 않는다.
- Related files: `docs/handbook/path-owner-map.json`, `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24032384700 --repo jj8127/Appointment-Process --log`, `git -C E:\hanhwa\fc-onboarding-app diff -- docs/handbook/path-owner-map.json`

## 2026-04-06 | Web Entry Routing | auth loop를 줄이려다 `/` 진입을 로더 고정 화면으로 남겨 실제 진입 경로가 끊김
- Symptom: `http://localhost:3000` 서버는 200 응답을 주지만, 브라우저에서는 첫 화면이 계속 로더만 보이고 `/auth`나 `/dashboard`로 넘어가지 않았다.
- Root cause: `/` 페이지에서 기존 client redirect를 제거한 뒤, 대체 분기 없이 로더만 렌더하도록 남겨 두었다. 그 결과 root entry가 세션 복원 이후에도 아무 route resolution을 하지 않았다.
- Why it was missed: `middleware`와 `dashboard` 보호 경로만 확인하고, 사용자가 가장 먼저 여는 `/` landing route를 실제 브라우저로 다시 밟지 않았다. HTTP 200과 build 통과를 entry flow 정상으로 과대해석했다.
- Permanent guardrail: auth/session 수정 뒤에는 `/`, `/auth`, `/dashboard` 세 진입점을 모두 브라우저 기준으로 확인한다. `/`는 세션에 따라 즉시 `/dashboard` 또는 `/auth`로 resolve되어야 하며, indefinite loader는 회귀로 본다.
- Related files: `web/src/app/page.tsx`, `web/src/hooks/use-session.tsx`, `web/src/app/auth/page.tsx`, `web/src/app/dashboard/layout.tsx`
- Verification: `http://localhost:3000` headless browser redirect 확인, `cd E:\hanhwa\fc-onboarding-app\web && npm run lint -- src/app/page.tsx`, `cd E:\hanhwa\fc-onboarding-app\web && npx next build`

## 2026-04-06 | Admin Web Workflow Tabs | 수당 동의에만 있던 direct-input 계약을 생명/손해 위촉 완료일에는 맞추지 않아 운영 입력 흐름이 탭마다 갈라짐
- Symptom: 총무는 `수당 동의` 탭에서는 `동의일(Actual)`을 trusted path로 직접 저장할 수 있었지만, `생명/손해 위촉` 탭에서는 같은 종류의 실제 완료일을 `승인 완료` 흐름에 기대어 우회적으로만 처리해야 했다.
- Root cause: dashboard workflow tab을 단계별로 따로 보강하면서 `실제 날짜 직접입력 + trusted save route + status normalization + list invalidation` 계약을 allowance에만 만들고 appointment에는 parity 체크를 하지 않았다.
- Why it was missed: 기존 appointment tab에 `승인 완료` 버튼이 이미 있다는 이유로 "총무도 입력 가능하다"라고 간주했고, 수당 동의에서 분리한 direct-input 패턴을 다른 workflow tab에도 적용해야 하는지까지 대조하지 않았다.
- Permanent guardrail: admin workflow tab에 `Actual` 날짜 입력이 있으면 allowance, hanwha, appointment를 같은 4축으로 비교한다. `직접 저장 버튼`, `trusted route action`, `status normalization`, `dashboard-list/detail invalidation` 중 하나라도 빠지면 parity drift로 본다.
- Related files: `web/src/app/dashboard/page.tsx`, `web/src/app/api/admin/fc/route.ts`, `web/src/lib/fc-workflow.ts`, `docs/handbook/admin-web/dashboard-lifecycle.md`
- Verification: `cd E:\hanhwa\fc-onboarding-app\web && npm run lint -- src/app/dashboard/page.tsx src/app/api/admin/fc/route.ts src/lib/fc-workflow.ts`, `cd E:\hanhwa\fc-onboarding-app\web && npx next build`, `cd E:\hanhwa\fc-onboarding-app && node scripts/ci/check-governance.mjs`

## 2026-04-06 | Governance / PR Diff Range | 로컬 거버넌스만 보고 장수 브랜치 전체 PR 거버넌스 상태를 확인하지 않아 PR 체크가 다시 실패
- Symptom: 로컬에서는 `node scripts/ci/check-governance.mjs`가 통과했는데, PR `Codex/referral rollout closeout #118`의 GitHub Actions governance check는 즉시 실패했다.
- Root cause: 현재 세션 변경분만 기준으로 거버넌스를 확인하고, `main -> 현재 브랜치 HEAD` 전체 PR diff range에서 남아 있던 governance debt를 다시 확인하지 않았다. 실제 실패 원인은 branch 전체 diff에 포함된 `supabase/functions/invite/index.ts`, `supabase/functions/tsconfig.json`, `supabase/functions/validate-referral-code/index.ts`에 대한 path-owner-map rule 누락이었다.
- Why it was missed: 장수 브랜치 위에 후속 커밋만 얹으면서 "방금 바꾼 것만 통과하면 된다"는 관성으로 봤고, PR 단위 기준(`BASE_SHA=main`, `HEAD_SHA=current branch`)과 로컬 기준을 분리해 생각하지 않았다.
- Permanent guardrail: 장수 브랜치나 기존 PR 위에 추가 커밋을 올릴 때는 로컬 검증만으로 닫지 않는다. 반드시 `gh run view` 또는 PR check 결과로 현재 PR 전체 diff의 governance 상태를 확인하고, 필요하면 `BASE_SHA=<main sha> HEAD_SHA=<branch sha> node scripts/ci/check-governance.mjs`처럼 PR 기준으로 다시 본다. 새 커밋이 docs-only여도 기존 브랜치 debt가 남아 있으면 "푸시 완료"로 보고하지 않는다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `gh run view 24017748248 --repo jj8127/Appointment-Process --log`, `gh run view 24017748248 --repo jj8127/Appointment-Process --json name,workflowName,conclusion,status,url,event,headBranch,headSha,jobs`

## 2026-04-06 | Verification Discipline | 실행하지 못한 검증을 문서에 통과처럼 먼저 적으려 한 실수
- Symptom: 게시판 알림 fanout 수정 후 `WORK_DETAIL`와 harness QA에 `deno check` 통과 문구를 먼저 넣었지만, 실제 shell에는 `deno` CLI가 없어 그 검증을 실행할 수 없었다.
- Root cause: 구현 직후 문서화를 하면서 "원래 돌려야 하는 검증 세트"를 그대로 적었고, 실제 명령 실행 가능 여부와 결과를 문서 반영보다 나중에 확인했다.
- Why it was missed: 코드 수정과 문서 갱신을 한 흐름으로 처리하면서, 검증 섹션을 계획이 아니라 증적로 써야 한다는 구분이 느슨해졌다.
- Permanent guardrail: 검증 문서에는 실제로 실행한 명령과 shell 결과만 적는다. 실행 불가 도구(`deno` 등)가 있으면 즉시 `불가`로 기록하고 대체 검증을 별도 줄로 남긴다. "pass" 문구는 명령 출력 확인 뒤에만 쓴다.
- Related files: `.claude/WORK_DETAIL.md`, `.codex/harness/qa-report.md`, `.codex/harness/handoff.md`
- Verification: 문서 수정 후 governance check

## 2026-04-06 | Board Notifications | 게시판 글 작성이 알림함 저장만 되고 푸시 fanout은 빠져 앱 푸시가 가지 않음
- Symptom: web 또는 가람in 앱에서 게시판 글을 작성하면 `notifications` row는 생겨 알림센터에는 보일 수 있지만, 가람in 기기와 admin/manager 대상 푸시는 전송되지 않았다.
- Root cause: `board-create`가 `notifications` 테이블에 직접 row만 insert하고 끝났고, Expo push + admin web push fanout의 SSOT인 `fc-notify` 경로를 호출하지 않았다.
- Why it was missed: 알림 저장과 푸시 발송을 별개 계약으로 분리해 두지 않았고, 인앱 알림함에서 row가 보이는 것만으로 "알림 구현 완료"처럼 판단했다.
- Permanent guardrail: 새 알림 소스가 `notifications`를 직접 기록하면 같은 change set에서 `fc-notify` fanout도 같이 연결하거나, `fc-notify`를 직접 통해 저장과 fanout을 한 번에 처리한다. 저장만 직접 수행하는 예외 경로는 `skip_notification_insert` 같은 명시적 계약으로 중복 insert를 막고, 검증도 `알림함 row + Expo/admin web push` 둘 다 확인한다.
- Related files: `supabase/functions/board-create/index.ts`, `supabase/functions/fc-notify/index.ts`, `docs/handbook/backend/notifications-inbox-push.md`
- Verification: Deno check, governance check

## 2026-04-06 | Web Profile Save Contract | FC 상세와 대시보드 모달의 profile-save 계약을 따로 유지해 임시사번 저장/단계 반영이 다시 어긋남
- Symptom: `/dashboard/profile/[id]`에서는 주소 등 기본정보를 저장해도 운영자는 여전히 목록에서 `사전등록`처럼 보인다고 느꼈고, 같은 상세 페이지에서는 `temp_id`를 아예 수정할 수 없었다.
- Root cause: 같은 FC profile 도메인을 다루는 `/dashboard` 모달과 `/dashboard/profile/[id]`가 서로 다른 save contract를 들고 있었다. 모달은 `temp_id`와 상태 보정을 함께 다뤘지만, 상세 페이지는 `temp_id` 필드 자체가 없었고 저장 후 `dashboard-list` invalidation도 빠져 있었다.
- Why it was missed: 상세 페이지를 `getProfile` trusted path로 복구할 때 read contract만 맞추고, edit contract가 모달과 같은지까지 비교하지 않았다. 화면 하나를 고친 뒤 같은 도메인의 다른 surface와 payload/query invalidation parity를 다시 체크하지 않았다.
- Permanent guardrail: FC profile을 수정하는 새 surface를 추가하거나 고칠 때는 `수정 가능한 필드`, `trusted route payload`, `status normalization`, `query invalidation` 네 축을 기존 대표 surface와 diff로 대조한다. 특히 `temp_id`, `allowance_date`, 추천인처럼 workflow에 직접 영향을 주는 필드는 한 화면만 따로 계약을 가지게 두지 않는다.
- Related files: `web/src/app/dashboard/profile/[id]/page.tsx`, `web/src/app/dashboard/page.tsx`, `web/src/app/api/admin/fc/route.ts`, `.claude/WORK_DETAIL.md`
- Verification: targeted web lint, `npx next build`, governance check

## 2026-04-06 | Web Auth Session | 서버 쿠키와 클라이언트 localStorage 세션 계약을 따로 봐서 redirect loop 재발
- Symptom: `/dashboard` 접근 시 `/auth`, `/`, `/dashboard` 요청이 반복되며 실제 관리자 웹에 안정적으로 들어가지 못했다.
- Root cause: middleware와 server route는 cookie(`session_role`, `session_resident`)를 세션 SSOT로 봤지만, `use-session`은 localStorage만 복원하고 protected layout이 client redirect를 직접 수행해, 쿠키는 유효하지만 client role은 `null`인 상태에서 `/dashboard -> /auth` bounce가 발생했다.
- Why it was missed: 이전 수정에서 "FC를 `/dashboard`로 보내지 않는다"는 역할 분기만 다루고, 서버와 클라이언트가 어떤 저장소를 세션 진실원으로 쓰는지는 따로 계약화하지 않았다.
- Permanent guardrail: admin web auth는 `cookie-first restore -> localStorage fallback -> cookie resync` 순서로 복원하고, protected route 접근 제어는 middleware를 1차 기준으로 둔다. layout/page에서 redirect를 추가할 때는 "middleware와 같은 세션 소스인가"를 먼저 확인한다.
- Related files: `web/src/hooks/use-session.tsx`, `web/middleware.ts`, `web/src/app/page.tsx`, `web/src/app/auth/page.tsx`, `web/src/app/dashboard/layout.tsx`, `web/src/app/admin/layout.tsx`
- Verification: targeted lint, web production build

## 2026-04-06 | Investigation Discipline | 스크린샷 surface와 실패 축을 확인하지 않고 부분 패치부터 진행해 재작업 발생
- Symptom: 사용자가 `/dashboard/exam/applicants` 주민등록번호 컬럼 스크린샷을 보냈는데도 처음에는 `/dashboard` 메인/모달 resident-number 경로와 접속 순환 문제를 먼저 따라가서, 실제 깨진 surface와 다른 곳을 고치고도 `여전히 안돼`가 반복됐다.
- Root cause: 화면 식별을 코드 검색보다 먼저 하지 않았고, "주소는 보이는데 주민번호만 실패"라는 신호를 충분히 활용하지 않아 `fc_profiles` 매칭 성공 + secure resident-number read 실패라는 축을 늦게 분리했다.
- Why it was missed: 이미 resident-number 회귀 맥락을 알고 있다는 이유로 현재 증거보다 기존 가설에 끌렸고, 사용자가 우선순위를 바꿨을 때도 그 지시를 바로 contract에 반영하지 않았다.
- Permanent guardrail: 스크린샷/사용자 제보가 오면 먼저 해당 헤더/문구를 실제 렌더링하는 화면과 route를 코드에서 식별한다. 증상별로 `화면 식별 -> 데이터 연결 성공 여부 -> secure read 실패 여부` 순서로 축을 분리한 뒤에만 패치한다. 사용자가 우선순위를 바꾸면 현재 작업 contract와 handoff를 즉시 재정렬한다.
- Related files: `web/src/app/dashboard/exam/applicants/page.tsx`, `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/lib/server-resident-numbers.ts`
- Verification: screen header search, targeted lint, web production build, governance check

## 2026-04-06 | Web Resident Number | direct decrypt 전용 경로를 남겨 시험 신청자 화면만 다시 전부 실패
- Symptom: `/dashboard` 모달과 `/dashboard/profile/[id]`는 resident-number 회귀를 정리했는데 `/dashboard/exam/applicants` 주민등록번호 열은 여전히 전부 `주민번호 조회 실패`로 남았다.
- Root cause: `exam-applicants` route가 `fc_profiles` 연결 일부만 맞춘 뒤에도 secure resident-number 읽기는 direct decrypt만 사용하고, `/api/admin/resident-numbers`가 가진 edge-function fallback 계약을 공유하지 않았다.
- Why it was missed: "전화번호 포맷 drift가 원인"이라는 중간 가설을 너무 빨리 확정해서, 실제로는 `fc_profiles` 매칭 이후의 resident-number fallback 불일치까지 동일 change set에서 정리해야 한다는 점을 놓쳤다.
- Permanent guardrail: resident-number full-view를 제공하는 모든 서버 경로는 direct decrypt와 edge-function fallback을 공통 유틸로 공유한다. 화면별 patch 전에 `주민번호를 누가 최종 반환하는가`를 route 단위로 나열하고, 새 surface를 찾으면 같은 change set에 묶어 업데이트한다.
- Related files: `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/lib/server-resident-numbers.ts`, `docs/handbook/admin-web/exam-and-referral-ops.md`
- Verification: targeted lint, web production build, governance check

## 2026-04-06 | Web Resident Number | 주민번호 full-view 회귀를 화면별 임시복구로 끝내서 다시 drift 발생
- Symptom: `fc-onboarding-app/web`에서 FC detail resident-number full-view가 이미 복구된 줄 알았지만 `/dashboard` 모달, `/dashboard/profile/[id]`, `/dashboard/exam/applicants` 가 다시 서로 어긋나거나 세션/전화번호 포맷 차이로 실패할 수 있는 상태가 남아 있었다.
- Root cause: resident-number client fetch와 secure-row 매핑이 화면/route별로 중복돼 있었고, admin/manager 전화번호 검증 및 FC 프로필 연결은 `/api/admin/resident-numbers`, `/api/admin/fc`, `/api/admin/exam-applicants` 가 서로 다른 규칙(raw/digits/formatted vs digits-only/exact-only)을 사용했다.
- Why it was missed: 기존 `WORK_LOG`/`WORK_DETAIL`은 변경 사실은 남겼지만 "이번 문제의 실수 패턴이 무엇인지"를 별도로 고정하지 않아, 다음 수정자가 다른 resident-number surface 하나를 빠뜨린 채 부분 복구로 끝내기 쉬웠다.
- Permanent guardrail: web resident-number 조회는 shared hook/공용 client 또는 공통 secure-row 매핑 규칙으로 통일하고, admin/manager 세션 전화번호 검증과 FC 프로필 phone 연결은 공통 후보(raw/digits/formatted) 규칙을 재사용한다. 같은 종류의 회귀를 고칠 때는 이 파일에 반드시 추가 기록한다.
- Related files: `web/src/hooks/use-resident-number.ts`, `web/src/lib/resident-number-client.ts`, `web/src/lib/server-session.ts`, `web/src/app/api/admin/resident-numbers/route.ts`, `web/src/app/api/admin/fc/route.ts`, `web/src/app/api/admin/exam-applicants/route.ts`, `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/profile/[id]/page.tsx`, `web/src/app/dashboard/exam/applicants/page.tsx`
- Verification: targeted web lint, web production build, governance check
