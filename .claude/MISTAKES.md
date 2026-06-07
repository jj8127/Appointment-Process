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

## 2026-06-07 | Referral Graph Node Size | highlight radius boost가 descendant size 의미를 오염
- Symptom:
  - 전체 하위 조직 수 기준이면 `김형수` 노드가 가장 커야 하는데, 화면에서는 노란 본부장 강조 노드가 비슷하거나 더 커 보였다.
  - 실제 graph API 데이터에서는 `김형수 descendantCount=76`으로 1등이고, 다음 노드는 `18` 수준이었다.
- Root cause:
  - `getReferralGraphNodeRadius`가 descendantCount를 받는 새 sizing mode에서도 기존 `highlightType ? +3.4px` 반경 보너스를 계속 적용했다.
  - 본부장 강조는 색/테두리 의미인데, 크기 의미까지 바꿔 "노드 크기 = 하위 조직 규모" 계약을 깨뜨렸다.
- Why it was missed:
  - 새 테스트가 descendant count 증가/캡만 검증했고, highlighted smaller branch와 unhighlighted dominant root의 상대 크기 순서를 고정하지 않았다.
  - 브라우저 캡쳐에서 김형수 실제 데이터 순위와 canvas radius 순위를 함께 비교하지 않았다.
- Permanent guardrail:
  - descendantCount가 제공되는 graph size mode에서는 반경이 descendant count로만 결정되어야 한다. Highlight/manager/viewer 의미는 fill/stroke/shadow/label로 표현하고 radius boost를 더하지 않는다.
  - 추천인 그래프 크기 변경 시 실제 데이터 상위 descendant 노드와 highlighted smaller branch의 radius ordering 테스트를 추가한다.
- Related files:
  - `web/src/lib/referral-graph-highlight.ts`
  - `web/src/lib/referral-graph-highlight.test.ts`
- Verification:
  - `node --test web/src/lib/referral-graph-highlight.test.ts web/src/lib/referral-graph-descendants.test.ts`
  - `node --test web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-simulation.test.ts`
  - `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test web/src/lib/referral-graph-realdata.test.ts`
  - `cd web; npm run lint`
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-05 | Referral Graph Realdata Test | production force 입력과 realdata helper 입력 drift
- Symptom:
  - 실제 Supabase 그래프 테스트가 같은 production force stack을 검증한다고 기록되어 있었지만, `forceLink.distance`에서 `sourceId`/`targetId`를 넘기지 않아 ID 기반 edge length jitter가 빠졌다.
  - 그 결과 실제 브라우저 Canvas와 realdata regression test의 교차/edge length 수치가 달라질 수 있었다.
- Root cause:
  - production Canvas에 `sourceId`/`targetId` 옵션을 추가한 뒤 realdata test helper를 같은 시점에 동기화하지 않았다.
- Why it was missed:
  - synthetic simulation helper는 이미 동기화되어 있었고, realdata helper도 같은 file family라 같은 계약을 쓴다고 가정했다.
- Permanent guardrail:
  - graph force 옵션을 추가할 때 Canvas, synthetic simulation helper, realdata helper 세 곳을 동시에 비교한다.
  - realdata test는 production-equivalent라는 표현을 쓰려면 `sourceId`/`targetId`, child/subtree counts, collision radius, force constants를 모두 맞춘다.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-realdata.test.ts`
  - `web/src/lib/referral-graph-simulation.test.ts`
- Verification:
  - `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`
  - `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`

## 2026-06-05 | GaramIn Board Categories | 보험소식 legacy 카테고리를 잘못 가람pick으로 재배치
- Symptom:
  - 사용자는 게시판 글 종류를 `공지`, `교육 일정`, `일반`, `가람pick` 4종으로 제한하고 기존 `보험소식` 글은 `일반`으로 옮기길 원했지만, 기존 4종 정리 migration은 `insurance-news` 글을 `garam-pick`으로 옮기도록 되어 있었다.
- Root cause:
  - 홈 최신 카드에 `가람pick`을 띄워야 한다는 요구와 자동 보험소식 브리핑을 `일반`으로 올려야 한다는 요구를 분리하지 않고, `insurance-news` legacy 정리를 `garam-pick` 노출 요구와 섞었다.
  - category list UI는 4종만 보여도 category create/update/post write 함수는 임의 category를 다시 만들 수 있었다.
- Why it was missed:
  - seed/migration/function/script를 한 계약으로 검증하는 테스트가 없었고, 기존 게시글 재배치 대상과 새 자동 게시 대상의 차이를 명시하지 않았다.
- Permanent guardrail:
  - 게시판 카테고리는 shared canonical list(`공지`, `교육 일정`, `일반`, `가람pick`)를 source of truth로 두고, 목록/생성/수정/게시글 작성 경계가 모두 같은 allowlist를 사용한다.
  - 자동 보험소식 브리핑은 `일반/general`에만 게시하고, 홈 최신 카드의 `가람pick` 노출 요구와 섞지 않는다.
  - `lib/__tests__/board-category-contract.test.ts`로 schema, migration, Edge Function, 자동 게시 스크립트의 카테고리 계약을 함께 고정한다.
- Related files:
  - `supabase/functions/_shared/board-categories.ts`
  - `supabase/migrations/20260605000001_set_board_categories_to_four_types.sql`
  - `supabase/schema.sql`
  - `supabase/functions/board-categories-list/index.ts`
  - `supabase/functions/board-category-create/index.ts`
  - `supabase/functions/board-category-update/index.ts`
  - `supabase/functions/board-create/index.ts`
  - `supabase/functions/board-update/index.ts`
  - `scripts/ops/post-insurance-digest.mjs`
  - `lib/__tests__/board-category-contract.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/board-category-contract.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
  - GREEN: `node --test scripts/ops/post-insurance-digest.test.mjs`

## 2026-06-05 | GaramIn Exam Apply | 필수값 누락 이유를 disabled 버튼으로 숨김
- Symptom:
  - FC가 응시료 납입 일자, 시험 일정, 응시 지역, 응시 과목 중 하나를 선택하지 않으면 `시험 신청하기` 버튼이 회색으로 비활성화되어 어떤 항목이 빠졌는지 알 수 없었다.
- Root cause:
  - submit `Pressable`의 `disabled` 조건에 필수 선택값 누락을 포함해, 상세 validation/Alert 경로가 실행되지 않았다.
- Why it was missed:
  - 저장 mutation 내부에는 일부 방어 검증이 있었지만, 모바일 UI에서 버튼 비활성화 상태가 먼저 클릭을 차단하는지 검증하지 않았다.
- Permanent guardrail:
  - 필수 입력 누락은 버튼을 침묵시키지 말고 클릭 가능한 상태에서 누락 항목 목록을 Alert로 안내한다.
  - 제출 버튼의 `disabled`는 중복 제출 방지 같은 실제 실행 불가 상태에만 제한한다.
  - 필수값 메시지 순서는 화면에 보이는 순서 기준 helper/test로 고정한다.
- Related files:
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
  - `lib/exam-application-validation.ts`
  - `lib/__tests__/exam-application-validation.test.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/exam-application-validation.test.ts --runInBand`

## 2026-06-05 | Manager Mobile Notifications | 설계매니저 토큰을 FC/admin broadcast 범위와 섞음
- Symptom:
  - 설계매니저 가람in에 설계 요청과 직접 채팅 외에도 게시판, 공지, 시험 등 불필요한 알림이 많이 도착했다.
- Root cause:
  - request-board 디자이너 세션이 Expo token을 `fc` scope로 등록할 수 있어 FC 전체 broadcast를 같이 받았다.
  - `fc-notify`의 `admin` 대상 broadcast는 `device_tokens.role in ('admin','manager')`를 그대로 포함했고, category 기반으로 manager 모바일 수신 범위를 줄이지 않았다.
  - 모바일 unread 계산도 request-board designer 세션에서 fc-onboarding unread를 live request_board unread와 합산할 수 있었다.
- Why it was missed:
  - 알림 fanout 검증을 FC/admin 중심으로만 보았고, 설계매니저 모바일은 request_board 전용 역할이라는 product scope를 별도 계약 테스트로 고정하지 않았다.
- Permanent guardrail:
  - 설계매니저 모바일 token은 `manager` scope로 저장한다.
  - manager token fanout은 `request_board_*` category 또는 구체적인 `target_id`가 있는 직접 채팅만 허용한다.
  - request-board designer unread는 fc-onboarding unread를 더하지 않고 live request_board unread만 사용한다.
- Related files:
  - `lib/push-registration.ts`
  - `hooks/use-session.tsx`
  - `lib/notifications.ts`
  - `lib/mobile-unread-notification-count-plan.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `supabase/functions/_shared/notification-delivery-policy.ts`
- Verification:
  - RED/GREEN: `npm test -- --runTestsByPath supabase/functions/_shared/__tests__/notification-delivery-policy.test.ts lib/__tests__/push-registration.test.ts --runInBand`
  - RED/GREEN: `npm test -- --runTestsByPath lib/__tests__/mobile-unread-notification-count-plan.test.ts --runInBand`

## 2026-06-03 | GaramIn Payment / Subagent Integration | 계획 계약과 실제 live path가 어긋남
- Symptom:
  - 가상계좌 v2 계획은 응시자별 토스 회전식 계좌, stored idempotency, `DEPOSIT_CALLBACK` source of truth, 요청 내부 중복 응시자 차단을 요구했지만 초기 통합 diff에는 발급 idempotency 저장 컬럼이 없고 webhook이 event type과 무관하게 상태를 반영했으며, 중복 차단은 순수 helper/test에만 있고 live submit flow에는 없었다.
  - 모바일 시험 신청 드롭다운도 같은 회차에 여러 응시자가 있을 때 응시자/본인·대리/입금상태를 구분하지 못했다.
- Root cause:
  - 병렬 subagent가 schema, service, mobile UI를 독립적으로 구현했고 coordinator가 초반에는 각 slice의 개별 통과 결과를 계약 전체의 통과로 취급했다.
  - 결제 source-of-truth 조건과 다중 응시자 UX 조건이 live function/UI 경로에서 끝까지 검증되지 않았다.
- Why it was missed:
  - 순수 contract test가 있었지만 실제 `submitExamApplications`/`handleExamPaymentWebhook` 경로가 그 helper를 사용하는지까지 보지 않았다.
  - selector label처럼 "카드 상세에는 정보가 있음"과 "선택 전에도 구분 가능함"을 별도 UX acceptance로 분리하지 않았다.
- Permanent guardrail:
  - PG/webhook 변경은 schema column, service payload, webhook gate, idempotent side effect, live submit preflight를 한 체크리스트로 검증한다.
  - 병렬 subagent 결과는 최종 evaluator에게 current diff 기준으로 재검토시키고, 실패 findings를 해결하기 전 완료로 말하지 않는다.
  - 다중 row/account UI는 카드 상세뿐 아니라 선택 목록 자체에서 대상자를 식별할 수 있어야 한다.
- Related files:
  - `supabase/functions/_shared/exam-payment-service.ts`
  - `supabase/functions/_shared/exam-payment.ts`
  - `supabase/migrations/20260603000001_garamin_ops_upgrade.sql`
  - `supabase/schema.sql`
  - `app/exam-apply.tsx`
  - `app/exam-apply2.tsx`
- Verification:
  - `node --experimental-strip-types --test supabase\functions\_shared\__tests__\exam-payment.test.ts`
  - `node --test supabase\functions\__tests__\exam-payment-schema.contract.test.ts`
  - `npm run lint -- app\exam-apply.tsx app\exam-apply2.tsx app\index.tsx app\home-lite.tsx app\appointment.tsx app\hanwha-commission.tsx app\dashboard.tsx app\docs-upload.tsx app\_layout.tsx lib\fc-workflow.ts`
  - `cd web; npm run lint`
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-03 | Admin Web File Open | 팝업 차단 시 signed URL 발급 전 중단함
- Symptom:
  - 관리자 웹 배포 후 총무가 FC 업로드 파일 `열기`를 눌렀을 때 `브라우저 팝업이 차단되어 파일을 열 수 없습니다` 알림이 떴고 파일이 열리지 않았다.
- Root cause:
  - `handleOpenDoc`가 `window.open` 결과가 `null`이면 즉시 실패 알림을 띄우고 return했다.
  - 이 때문에 브라우저/환경이 새 창을 막는 경우에도 `/api/admin/fc` `signDoc`를 호출하지 않아 같은 탭 fallback으로 파일을 열 기회가 없었다.
- Why it was missed:
  - 이전 테스트는 pending popup이 열리는 정상 경로와 실패 시 close만 고정했고, popup 자체가 차단된 뒤 signed URL을 현재 탭으로 여는 fallback 계약을 포함하지 않았다.
- Permanent guardrail:
  - async signed URL 파일 열기는 popup이 열리면 popup을 이동시키고, popup이 차단되면 signed URL 발급 후 현재 탭을 이동시킨다.
  - `web/src/lib/admin-file-open.test.ts`에 popup-block fallback 계약을 유지한다.
- Related files:
  - `web/src/app/dashboard/page.tsx`
  - `web/src/lib/admin-file-open.ts`
  - `web/src/lib/admin-file-open.test.ts`
- Verification:
  - RED: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts`
  - GREEN: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts src/lib/admin-fc-doc-storage.test.ts`
  - `cd web; npm run lint -- src/lib/admin-file-open.ts src/lib/admin-file-open.test.ts src/app/dashboard/page.tsx src/app/api/admin/fc/route.ts src/lib/admin-fc-doc-storage.ts src/lib/admin-fc-doc-storage.test.ts`
  - `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-03 | Admin Web Parallel Fix | 서브에이전트 변경이 같은 파일의 문구 수정분을 되돌림
- Symptom:
  - 문구 정리 담당 서브에이전트가 `trusted path` 사용자 노출 문구를 고쳤다고 보고했지만, 파일 열기 담당 변경 이후 `web/src/app/dashboard/page.tsx`에 같은 문장이 다시 남아 있었다.
- Root cause:
  - 두 서브에이전트가 같은 대시보드 파일을 독립적으로 수정했고, 후속 파일 열기 patch가 선행 copy cleanup diff를 되돌렸다.
- Why it was missed:
  - 병렬 위임 결과를 그대로 신뢰하면 각 에이전트의 개별 diff만 맞고 통합 diff에서는 한쪽 변경이 사라지는 상태를 놓칠 수 있다.
- Permanent guardrail:
  - 병렬/서브에이전트 작업이 같은 파일을 건드리면 coordinator가 최종 통합 diff와 exact regression search를 다시 수행한다.
  - 사용자-visible 문구 이슈는 최종 source search가 비어야 완료로 본다.
- Related files:
  - `web/src/app/dashboard/page.tsx`
  - `.codex/harness/qa-report.md`
- Verification:
  - `Get-ChildItem web/src -Recurse -Include *.tsx,*.ts | Select-String -Pattern 'trusted path','상태 흐름','동의일\\(Actual\\)'`

## 2026-06-03 | Admin Web File Open | noopener placeholder 창으로 signed URL 이동 대상 참조를 잃음
- Symptom:
  - 업로드 파일 `열기` 복구 patch가 async fetch 전 빈 창을 열도록 바꿨지만, `window.open('', '_blank', 'noopener,noreferrer')`를 사용하면 브라우저가 새 창 참조를 `null`로 반환할 수 있어 팝업 차단으로 오진하거나 이동 대상이 사라질 수 있었다.
- Root cause:
  - 팝업 차단 회피를 위해 사용자 클릭 시점에 창을 열어야 하는 요구와 `noopener` feature가 창 참조를 끊는 브라우저 동작을 함께 고려하지 않았다.
- Why it was missed:
  - 단순히 "async 전에 window.open"만 확인했고, returned window reference가 유지되는지에 대한 계약 테스트가 없었다.
- Permanent guardrail:
  - signed URL처럼 async 준비가 필요한 파일 열기는 클릭 시점에 pending tab을 열고, 참조를 받은 뒤 `opener`를 수동으로 끊고, async 성공 시 그 창을 이동시킨다.
  - 해당 계약은 `web/src/lib/admin-file-open.test.ts`로 고정한다.
- Related files:
  - `web/src/lib/admin-file-open.ts`
  - `web/src/lib/admin-file-open.test.ts`
  - `web/src/app/dashboard/page.tsx`
- Verification:
  - RED: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts`
  - GREEN: `node --experimental-strip-types --test src/lib/admin-file-open.test.ts`

## 2026-06-03 | Mobile Exam Registration | 입력 중인 시험 지역을 저장 payload에서 누락함
- Symptom:
  - 총무가 가람in 모바일 시험 일정 화면에서 신규 시험을 등록하려 할 때 등록이 안 된 것처럼 보였다.
  - 화면에서 지역명을 입력해도 `지역 추가`를 따로 누르지 않으면 저장 payload에 지역이 포함되지 않았고, 신규 시험을 지역 0개로 저장할 수 있었다.
- Root cause:
  - `app/exam-register.tsx`와 `app/exam-register2.tsx`가 `locations` payload를 committed `draftLocations`에서만 만들었다.
  - 입력칸의 pending `locationInput`은 저장 시점에 합쳐지지 않았고, 모바일에는 웹/관리자 경로와 같은 최소 1개 지역 validation이 없었다.
- Why it was missed:
  - 모바일 화면의 "입력 후 바로 저장" 흐름을 별도 계약 테스트로 고정하지 않았다.
  - 기존 검증은 `admin-action` create/delete 가능 여부나 이미 추가된 draft location 중심이라, typed-but-not-added 지역 누락을 잡지 못했다.
- Permanent guardrail:
  - 시험 일정 저장 payload는 committed draft locations와 pending location input을 함께 normalize해서 만든다.
  - 신규 시험 저장은 최소 1개 기존/신규 지역을 요구한다.
  - 생명/손해 시험 등록 화면은 같은 helper/contract test를 공유해 payload drift를 막는다.
- Related files:
  - `app/exam-register.tsx`
  - `app/exam-register2.tsx`
  - `lib/exam-round-location-payload.ts`
  - `lib/__tests__/exam-round-location-payload.test.ts`
- Verification:
  - RED: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand` failed before helper implementation.
  - GREEN: `npm test -- --runTestsByPath lib/__tests__/exam-round-location-payload.test.ts --runInBand`
  - `npm run lint -- app/exam-register.tsx app/exam-register2.tsx lib/exam-round-location-payload.ts lib/__tests__/exam-round-location-payload.test.ts`
  - `npm test -- --runInBand`
  - `npm run lint`
  - `node scripts/ci/check-governance.mjs`

## 2026-06-01 | Sentry Token Operations | 조회용 토큰 대신 upload token을 먼저 사용함
- Symptom:
  - Sentry issue/project 조회를 시작할 때 `SENTRY_AUTH_TOKEN`을 먼저 사용해 org/project read API 권한 부족으로 실패했다.
  - 다른 AI 세션도 같은 변수명 혼동을 반복할 수 있다.
- Root cause:
  - `SENTRY_AUTH_TOKEN`은 release/source-map upload 목적이고, Sentry API 조회에는 `SENTRY_READ_AUTH_TOKEN`이 필요하지만 workspace 지침과 env example에 역할 구분이 충분히 고정되어 있지 않았다.
- Why it was missed:
  - Sentry SDK/build plugin 관례상 `SENTRY_AUTH_TOKEN` 이름이 눈에 먼저 띄었고, read-only investigation token을 우선해야 한다는 guardrail이 문서화되어 있지 않았다.
- Permanent guardrail:
  - Sentry API 조회는 `SENTRY_READ_AUTH_TOKEN`만 사용한다.
  - `SENTRY_AUTH_TOKEN`은 upload/release/source-map 용도로만 취급하고 read fallback으로 쓰지 않는다.
  - local verification build는 필요 시 `SENTRY_AUTH_TOKEN=''`로 upload를 끈다.
- Related files:
  - `E:\hanhwa\AGENTS.md`
  - `.env.example`
  - `README.md`
- Verification:
  - `node scripts/ci/check-governance.mjs`
  - `git diff --check`

## 2026-06-01 | Mobile Alert Actions | runOnJS에 함수 포함 버튼 객체를 넘겨 Alert 버튼 탭 crash
- Symptom:
  - Sentry `REACT-NATIVE-3`에서 Android Hermes fatal `TypeError: Object is not a function`이 38 events / 20 users로 보고됐다.
  - 최신 이벤트는 release `fc-onboarding-app@3.1.12`, dist `45`였고, alert modal 내부 touch 직후에 발생했다.
- Root cause:
  - `AppAlertProvider`가 Reanimated `runOnJS(onButtonPress)`로 `onPress` 함수를 포함할 수 있는 alert button 객체 전체를 넘겼다.
  - JS 복귀 후에는 `button.onPress` truthiness만 보고 호출해, worklet 경계를 지나며 non-callable로 변한 값도 함수처럼 호출할 수 있었다.
- Why it was missed:
  - 기존 AppAlertProvider 계약 테스트는 아이콘 asset 회귀만 확인했고, runOnJS payload serializability와 callable guard는 고정하지 않았다.
  - Sentry 이벤트에 `js_no_source`가 떠 실제 source frame 확인이 늦어졌다.
- Permanent guardrail:
  - Reanimated `runOnJS`에는 primitive id/index 같은 serializable payload만 넘기고, 함수/객체 해석은 JS side에서 다시 한다.
  - alert action 호출은 항상 `typeof onPress === 'function'`으로 가드한다.
  - AppAlertProvider 계약 테스트에 runOnJS index payload와 callable guard를 유지한다.
- Related files:
  - `components/AppAlertProvider.tsx`
  - `components/app-alert-utils.ts`
  - `components/__tests__/AppAlertProvider.contract.test.ts`
- Verification:
  - `npm test -- --runTestsByPath components/__tests__/AppAlertProvider.contract.test.ts --runInBand`
  - `npm run lint`
  - `npm test -- --runInBand`
  - `SENTRY_AUTH_TOKEN='' npm run build`

## 2026-05-31 | Admin Web Route Smoke | redirect-following smoke로 public route 보호 회귀를 놓침
- Symptom:
  - harness에는 `/reset-password` production smoke가 200으로 기록돼 있었지만, redirect를 따르지 않는 현재 smoke에서는 `/reset-password`가 307로 `/auth`에 redirect됐다.
  - 비밀번호 변경 화면은 `/auth`에서 진입하는 public flow인데 middleware public path에 포함되지 않아 비로그인 사용자가 직접 열 수 없었다.
- Root cause:
  - `web/middleware.ts`의 public route list가 `/auth`, `/invite`, favicon/manifest만 포함하고 `/reset-password`를 빠뜨렸다.
  - 이전 HTTP smoke가 redirect follow 여부를 명확히 고정하지 않아 최종 `/auth` 200을 `/reset-password` 200처럼 기록할 수 있었다.
- Why it was missed:
  - route accessibility smoke에서 redirect status와 `Location` header를 따로 확인하지 않았다.
  - password reset이 auth page에서 출발하지만 비로그인 public route여야 한다는 계약을 middleware-level characterization으로 고정하지 않았다.
- Permanent guardrail:
  - protected/public route smoke는 redirect를 따르지 않고 status + `Location`을 함께 기록한다.
  - admin web public paths는 shared helper와 direct Node characterization test로 관리한다.
  - password reset, invite, auth처럼 비로그인 entrypoint인 route는 middleware public-path 테스트에 포함한다.
- Related files:
  - `web/middleware.ts`
  - `web/src/lib/admin-web-public-paths.ts`
  - `web/src/lib/admin-web-public-paths.test.ts`
  - `.codex/harness/current-contract.md`
- Verification:
  - RED: `node --experimental-strip-types --test web/src/lib/admin-web-public-paths.test.ts` failed before helper implementation with `ERR_MODULE_NOT_FOUND`.
  - GREEN: the same test passed after helper implementation.
  - No-redirect production smoke after fix: `/reset-password=200`, `/auth=200`, `/dashboard=307 location=/auth`.

## 2026-05-30 | Coverage Verification | exit 0만 보고 coverage 수집 오류를 놓칠 수 있음
- Symptom:
  - `npm run test:coverage -- --runInBand`가 exit 0으로 끝났지만, 출력에는 TSX JSX/Babel coverage collection error와 `hooks/use-my-referral-code.ts` 타입 collection error가 함께 있었다.
  - exit code만 보면 coverage가 정상이라고 오판할 수 있었다.
- Root cause:
  - root Jest는 Expo/Babel test transform으로 통과하지만 coverage collection은 별도 instrumentation 경로를 타며, 기존 provider가 일부 TSX/TS source를 깨끗하게 수집하지 못했다.
- Why it was missed:
  - 검증 명령 성공 여부를 exit code 중심으로만 보려는 습관이 있었고, coverage output의 collection errors를 별도 실패 신호로 취급하지 않았다.
- Permanent guardrail:
  - coverage 명령은 exit code뿐 아니라 output의 `Failed to collect coverage`, parser/type error, skipped instrumentation warning까지 읽고 기록한다.
  - `npm run test:coverage -- --runInBand`는 V8 coverage provider 유지 여부까지 함께 확인한다.
- Related files:
  - `jest.config.js`
  - `.codex/harness/current-contract.md`
  - `.codex/harness/qa-report.md`
  - `.claude/MISTAKES.md`
- Verification:
  - Before fix: `npm run test:coverage -- --runInBand` exited 0 but emitted coverage collection errors.
  - After fix: `coverageProvider: 'v8'` added to `jest.config.js`.
  - After fix: `npm run test:coverage -- --runInBand` passed 29 suites / 185 tests with no prior coverage collection errors.

## 2026-05-30 | Next.js Web Build | Production source에 `.ts` 확장자 상대 import를 사용함
- Symptom:
  - `web` build가 TypeScript 단계에서 `An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled` 오류로 실패했다.
  - 실패 지점은 새 production helper `web/src/lib/resident-number-edge-executor.ts`의 `./resident-number-edge-fallback.ts` / `./resident-number-edge-response.ts` import였다.
- Root cause:
  - Node `--experimental-strip-types` 기반 characterization test는 test 파일에서 `.ts` 확장자 import가 필요하지만, 같은 패턴을 production source에 적용하면 Next.js/TypeScript build 규칙과 충돌한다.
- Why it was missed:
  - 대상 lint와 direct Node tests만 먼저 통과했고, production source import 경로가 TypeScript build에서 별도로 검증된다는 차이를 build 실행 전까지 확인하지 못했다.
- Permanent guardrail:
  - `.ts` 확장자 import는 direct Node test 파일에만 사용한다.
  - Production source는 extensionless/alias import를 유지하거나, Node test compatibility가 필요하면 production helper가 의존성을 주입받도록 분리한다.
  - 새 production helper가 다른 TS helper를 import할 때는 targeted lint만으로 마감하지 말고 가능한 범위에서 `web` build 또는 typecheck를 함께 실행한다.
- Related files:
  - `web/src/lib/resident-number-edge-executor.ts`
  - `web/src/lib/resident-number-edge-executor.test.ts`
  - `web/src/lib/server-resident-numbers.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - Before fix: `cd web; npm run build` failed at `resident-number-edge-executor.ts` `.ts` import path.
  - After fix: executor receives request/response helpers as dependencies; `server-resident-numbers.ts` injects existing helpers through production-safe imports.
  - After fix: `cd web; npm run build` passed.

## 2026-05-26 | Insurance Digest Automation | WindowsApps PowerShell 버전 경로를 예약 작업에 고정함
- Symptom:
  - 2026-05-22 이후 `보험소식 브리핑` 자동화 산출물과 게시글이 생성되지 않았다.
  - Windows Task Scheduler는 2026-05-26 11:05 KST에 실행을 시도했지만 `LastTaskResult=2147942402`로 실패했다.
- Root cause:
  - 예약 작업 action이 `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`처럼 특정 PowerShell Store package 버전 경로를 직접 가리켰다.
  - 로컬 PowerShell이 7.6.2로 업데이트되면서 7.6.1 경로가 사라졌고, Task Scheduler가 스크립트 시작 전 `file not found`로 종료했다.
- Why it was missed:
  - 2026-05-19에 `pwsh.exe` 사용만 가드레일로 남기고, WindowsApps의 versioned package path가 업데이트 때 사라진다는 점을 별도 acceptance로 고정하지 않았다.
  - 예약 작업 등록 뒤 다음 날 실제 `LastRunTime`, `LastTaskResult`, `.codex-tmp/insurance-digest/YYYY-MM-DD.*`, DB 게시글까지 묶어서 확인하지 않았다.
- Permanent guardrail:
  - Task Scheduler action에는 WindowsApps versioned package path를 저장하지 않는다. 사용자별 alias(`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`)나 별도 안정 wrapper 경로만 사용한다.
  - PowerShell/Codex/Windows 업데이트 후에는 `Test-Path`로 action executable을 확인하고, `-DryRun`과 수동 trigger를 같이 실행한다.
  - 자동화 성공 보고 전에는 Task Scheduler 결과, 당일 artifact 생성, 당일 board post 존재를 모두 확인한다.
- Related files:
  - `scripts/ops/run-insurance-digest-codex.ps1`
  - `.codex-tmp/insurance-digest/*`
  - Windows Task Scheduler `GaramIn Insurance Digest Codex Fallback`
  - `.claude/MISTAKES.md`
- Verification:
  - Before fix: `LastTaskResult=2147942402`, old `pwsh.exe` path `Test-Path=False`
  - Updated action: `C:\Users\jj812\AppData\Local\Microsoft\WindowsApps\pwsh.exe`
  - `run-insurance-digest-codex.ps1 -DryRun` succeeded through the new executable and resolved `codex.cmd`

## 2026-05-22 | Board Create Notifications | 로컬 최신 board-create를 배포하지 않아 자동 게시 push fanout이 빠짐
- Symptom:
  - 2026-05-22 보험소식 브리핑은 자동 게시됐고 알림센터 row도 생성됐지만 앱 push 알림이 오지 않았다.
- Root cause:
  - 원격 `board-create` Edge Function 배포본이 로컬 최신 코드와 달랐다.
  - 라이브 DB에 생성된 notification title이 로컬 코드의 `새 게시글`이 아니라 이전 배포본의 `New board post`로 저장되어, 원격 함수가 `fc-notify` push fanout 연결 전 코드였음이 확인됐다.
- Why it was missed:
  - 로컬 코드와 테스트만 보고 `board-create` fanout이 운영에 적용됐다고 판단했고, 실제 원격 함수 배포본의 행위까지 smoke하지 않았다.
- Permanent guardrail:
  - board notification/fanout 수정 후에는 반드시 해당 Edge Function을 배포하고, 라이브 게시글 1건 기준으로 `notifications.target_url`, notification title, FC/admin push fanout 결과를 함께 확인한다.
  - 이미 게시된 보험 브리핑의 push 재발송은 `fc-notify`에 `skip_notification_insert: true`를 넣어 알림센터 row 중복 없이 수행한다.
- Related files:
  - `supabase/functions/board-create/index.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - live DB: `보험소식 브리핑 2026.05.22` post `163d9aae-395f-4ba4-af3c-7d6d9535ec16`와 FC/admin/manager notification rows 확인
  - `supabase functions deploy board-create --project-ref ubeginyxaotcamuqpmud`
  - manual `fc-notify` push retry with `skip_notification_insert: true`: FC 195 tokens ok, admin/manager 69 tokens ok, admin web push 3 sent / 0 failed

## 2026-05-21 | Board Update Notifications | 게시글 생성과 수정의 알림 계약을 따로 관리함
- Symptom:
  - 게시판 글을 수정해도 FC/admin 알림센터 row와 push fanout이 발생하지 않았다.
- Root cause:
  - `board-create`에는 notification row insert와 `fc-notify` fanout이 있었지만, `board-update`는 게시글 수정만 하고 알림 경로가 없었다.
- Why it was missed:
  - 게시글 알림 검증이 신규 작성 경로 중심이었고, 수정 경로가 같은 독자 알림 계약을 가져야 한다는 contract test가 없었다.
- Permanent guardrail:
  - board write function을 추가하거나 바꿀 때는 inbox row persistence, `fc-notify` push fanout, `/board-detail?postId=...` target URL을 함께 검증한다.
  - `board-update` fanout 존재를 고정하는 contract test를 유지한다.
- Related files:
  - `supabase/functions/board-update/index.ts`
  - `supabase/functions/__tests__/board-update-notification.contract.test.ts`
  - `docs/handbook/backend/notifications-inbox-push.md`
  - `docs/handbook/backend/board-api-and-notice-model.md`
- Verification:
  - `npm test -- --runTestsByPath supabase/functions/__tests__/board-update-notification.contract.test.ts --runInBand`
  - `supabase functions deploy board-update --project-ref ubeginyxaotcamuqpmud`

## 2026-05-19 | Insurance Digest Automation | Windows fallback를 실제 Task Scheduler 환경과 Codex CLI 버전에 맞춰 검증하지 않음
- Symptom:
  - PC가 켜져 있었는데도 2026-05-19 11:05 KST Windows fallback이 `LastTaskResult=1`로 실패했고 보험 브리핑이 자동 게시되지 않았다.
  - 수동 재실행 중에도 기존 작업은 `powershell.exe`가 UTF-8 한글 prompt를 깨뜨리고, Codex CLI 실행이 오래 `Running`으로 남을 수 있었다.
- Root cause:
  - `run-insurance-digest-codex.ps1`가 현재 Codex CLI `0.101.0`에 없는 `--search` 플래그를 계속 넘겼다.
  - Task Scheduler action이 Windows PowerShell 5.x(`powershell.exe`)라 UTF-8 BOM 없는 `.ps1`의 한글 prompt를 ANSI로 읽었다.
  - 이미 같은 날짜 게시글이 있어도 중복 확인을 Codex prompt에 맡겨 불필요하게 Codex CLI를 띄웠다.
- Why it was missed:
  - `-DryRun`만 확인하고 실제 Task Scheduler action의 실행 파일, encoding, unsupported CLI flag를 함께 smoke하지 않았다.
  - Codex app cron과 Windows fallback을 같은 성공 기준으로 검증하지 않고, "예약 등록됨"을 "게시 경로 검증됨"으로 과대 해석했다.
- Permanent guardrail:
  - Windows 예약 작업은 `pwsh.exe`로 실행하고, script 상단에서 UTF-8 output encoding을 명시한다.
  - Codex CLI 플래그는 `codex exec --help` 기준으로 smoke하고, unsupported flag가 있으면 fallback 등록 전 제거한다.
  - 같은 날짜 글 존재 여부는 AI 실행 전 Node precheck(`--check-existing`)로 먼저 확인해, 이미 게시된 날에는 Codex를 띄우지 않는다.
- Related files:
  - `scripts/ops/run-insurance-digest-codex.ps1`
  - `scripts/ops/post-insurance-digest.mjs`
  - `scripts/ops/post-insurance-digest.test.mjs`
  - `.claude/MISTAKES.md`
- Verification:
  - `codex exec --help`
  - `node --test scripts/ops/post-insurance-digest.test.mjs`
  - `npm run ops:post-insurance-digest -- --check-existing`
  - Windows Task Scheduler manual run returned `LastTaskResult=0` with `precheck-2026-05-19.json`

## 2026-05-18 | Insurance Digest Automation | Codex cron 실행 여부와 remote migration drift를 별도로 감시하지 않음
- Symptom:
  - 2026-05-18 08:30 KST 보험 브리핑 자동 게시가 다시 실행되지 않아 오늘 게시글이 없었다.
  - 수동 게시 후에도 `board-create`가 넣어야 하는 알림 row가 비어 있었고, FC/admin 알림은 별도 `fc-notify` 수동 호출로 보강해야 했다.
- Root cause:
  - Codex app cron은 오늘 08:30 KST 이후 새 session/payload 흔적이 없어 스케줄 자체가 기대 시간에 시작되지 않았다.
  - 원격 DB의 `notifications_recipient_role_check`가 아직 `manager`를 허용하지 않아, `board-create`의 FC/admin/manager 3건 batch insert가 `manager` row에서 전부 rollback됐다.
- Why it was missed:
  - 자동화 생성/수정 뒤 다음날 "스케줄이 실제로 시작됐는가"를 별도 heartbeat나 OS-level fallback으로 감시하지 않았다.
  - `schema.sql`에는 `manager` 허용이 반영돼 있었지만 대응 migration이 없어 원격 제약과 local schema가 drift난 것을 live board post smoke 전까지 잡지 못했다.
- Permanent guardrail:
  - 보험 브리핑은 11:30 KST 기준으로 게시글, `latest_notice`, FC/admin `inbox_list`를 함께 확인한다.
  - Codex app cron만 믿지 않고 Windows Task Scheduler / Codex CLI fallback을 11:05 KST에 둔다.
  - notification role/check constraint 변경은 반드시 migration으로 남기고 remote debug insert로 검증한다.
- Related files:
  - `scripts/ops/run-insurance-digest-codex.ps1`
  - `supabase/migrations/20260518000001_allow_manager_notifications.sql`
  - `docs/handbook/operations-runbook.md`
  - `.codex/harness/qa-report.md`
- Verification:
  - 2026-05-18 manual post `bbb63250-c3ee-409b-80bf-139927d675a1`
  - remote `latest_notice` and FC/admin `inbox_list`
  - `supabase db push --linked --yes`
  - post-migration direct FC/admin/manager debug insert and cleanup
  - Windows scheduled task registration/reschedule and `scripts/ops/run-insurance-digest-codex.ps1 -DryRun`

## 2026-05-17 | Insurance Digest Board/Home/Push | live smoke에서 UI/notification 계약까지 확인하지 않음
- Symptom:
  - 2026-05-17 보험 브리핑 게시글 본문에 긴 raw URL과 AI 참고용/비자문 문구가 보여 사용자 요구와 맞지 않았다.
  - 게시글 링크 터치와 홈 최신 공지에서 게시판 상세로 들어간 뒤 X 닫기 crash가 보고됐다.
  - 첫 live post는 FC/admin 알림 row와 홈 최신 공지 노출이 확인되지 않았고, FC push는 Expo 100개 payload 제한에 걸렸다.
- Root cause:
  - 게시 성공/중복 skip만 확인하고, 실제 앱 상세 화면의 link rendering, home route, notification row, Expo push response를 같은 smoke 범위로 묶지 않았다.
  - `latest_notice`는 `notice` board category만 포함했고 `insurance-news`를 포함하지 않았다.
  - `board_notice:` route가 `/board?postId=` modal path로 들어가며 modal close의 `router.replace('/board')`가 `beforeRemove` listener와 충돌할 수 있었다.
  - `fc-notify`는 Expo push payload를 100개 단위로 나누지 않았다.
- Why it was missed:
  - 자동 게시 파일럿의 검증 기준이 backend posting script 중심이었고, 모바일 홈/상세 UI와 push transport 제한까지 포함하지 않았다.
  - 원문 URL을 `sourceUrls` 검증용 데이터와 visible board content로 동시에 취급했다.
- Permanent guardrail:
  - 보험 브리핑 live smoke는 `board-detail` content, `latest_notice`, FC/admin `inbox_list`, Expo push result를 모두 확인한다.
  - visible board content에는 raw URL과 AI 참고용/비자문 disclaimer를 넣지 않는다. 원문 URL은 `sourceUrls` payload에만 둔다.
  - board notice home routes는 standalone `/board-detail` path를 우선 사용한다.
  - push fanout 코드는 Expo 100 payload/request 제한을 지켜 chunk 전송한다.
- Related files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `supabase/functions/fc-notify/index.ts`
  - `app/index.tsx`
  - `app/board.tsx`
  - `lib/notice-route.ts`
  - `components/LinkifiedSelectableText.tsx`
- Verification:
  - `node --test scripts/ops/post-insurance-digest.test.mjs`
  - `npm test -- --runTestsByPath lib/__tests__/external-url.test.ts lib/__tests__/notice-route.test.ts lib/__tests__/home-latest-notice.test.ts --runInBand`
  - remote `board-detail`, `latest_notice`, `inbox_list`, and chunked FC push retry checks

## 2026-05-17 | Codex Insurance Digest Automation | runner 실패를 게시 성공과 혼동할 수 있는 자동화 계약
- Symptom:
  - 첫 보험 브리핑 자동화가 digest와 출처를 만들었지만 게시 스크립트를 실행하지 못해 게시판에는 글이 없었다.
  - 자동화 결과만 보면 요약문이 생성되어 게시 완료처럼 오해할 수 있었다.
- Root cause:
  - Codex Desktop background runner에서 `CreateProcessAsUserW failed: 1312`가 발생해 `pwd`와 게시 스크립트 실행이 모두 실패했다.
  - 기존 prompt는 inline JSON 명령만 강조했고, shell 실행 실패를 업로드 실패로 명시 보고하라는 guardrail이 약했다.
- Why it was missed:
  - 자동화 생성 직후 production smoke posting을 하지 않았고, 첫 background run의 shell 실행 가능성을 별도로 확인하지 않았다.
  - 게시판 조회 결과와 자동화 세션 로그를 대조하기 전까지 "요약 생성"과 "게시 완료"가 분리되어 있었다.
- Permanent guardrail:
  - Codex 게시 자동화는 대형 JSON을 shell inline 인자로 넘기지 말고 `.codex-tmp/` payload 파일 + `--input-file`을 사용한다.
  - 자동화가 shell runner failure를 만나면 반드시 blocker로 보고하고, 게시 성공으로 표현하지 않는다.
  - 첫 실행 또는 prompt 변경 뒤에는 게시판 중복-skip 확인까지 포함해 smoke 검증한다.
- Related files:
  - `scripts/ops/post-insurance-digest.mjs`
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `docs/handbook/operations-runbook.md`
- Verification:
  - `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/2026-05-17.json`
  - 동일 명령 재실행 시 `status: skipped`

## 2026-04-26 | Admin Referral Graph | 체크리스트 미완료 상태를 완료처럼 보고함
- Symptom:
  - 사용자가 추천인 그래프의 모든 체크리스트를 완벽히 검수했는지 확인했을 때, 실제로는 cluster/orphan 분포 simulation이 실패하고 있었는데 완료처럼 응답했다.
  - harness와 referral incident 문서도 v7 four-force reset 기준의 pass 상태로 남아, 현재 v14 hybrid force 구현과 남은 실패를 반영하지 못했다.
- Root cause:
  - nonblank canvas, 일부 helper unit test, targeted lint 통과를 전체 graph UX acceptance 통과로 확대 해석했다.
  - 브라우저 피드백과 simulation failure를 문서/QA 상태에 즉시 반영하지 않아, "완료"와 "부분 통과"가 섞였다.
- Why it was missed:
  - 체크리스트를 단일 source of truth로 유지하지 않고, 수동 시각 확인과 개별 테스트 결과를 따로 기억했다.
  - `web/src/lib/referral-graph-simulation.test.ts` 실패를 남긴 상태에서 docs/harness의 완료 문구를 먼저 닫았다.
- Permanent guardrail:
  - graph 작업은 `qa-report.md`에 pass/fail을 분리 기록하고, 하나라도 실패하면 최종 답변에서 "완료"라고 쓰지 않는다.
  - `web/src/lib/referral-graph-simulation.test.ts`가 실패하면 cluster separation, isolated shell, drag edge stretch 체크리스트는 미완료로 둔다.
  - 문서화/커밋 전에는 `docs`, `.codex/harness`, `.claude`가 현재 구현의 storage key/force list/test status와 맞는지 검색으로 확인한다.
- Related files:
  - `web/src/lib/referral-graph-simulation.test.ts`
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-simulation.test.ts`

## 2026-04-25 | Admin Referral Graph | Obsidian 동등성 요구에 custom force를 계속 쌓아 기본 물리를 흐림
- Symptom:
  - 사용자가 Obsidian Graph View처럼 안정적이고 예측 가능한 force-directed graph를 요구했지만, 이전 구현은 component collision, hub fanout, degree-aware link, branch-aware bridge, drop tether를 계속 추가해 drag/release와 final layout이 사용자 기대와 다르게 흔들렸다.
  - 최종적으로 `node not found` browser runtime 오류까지 확인됐다. 원인은 새 `forceLink(graphData.links)`를 직접 만들며 `react-force-graph` 내부 노드 배열과 링크 endpoint가 어긋난 것이었다.
- Root cause:
  - Obsidian 동등성 요청을 "비슷한 모양을 만드는 보정 force"로 해석했고, 실제 Obsidian식 public contract인 `Center force`, `Repel force`, `Link force`, `Link distance` 네 설정 중심으로 되돌리는 결정을 늦게 했다.
  - 기존 internal link force를 설정해야 하는 자리에서 새 d3 link force를 주입해 library 내부 simulation lifecycle과 충돌했다.
- Why it was missed:
  - 개별 증상(parent ring, group gap, branch child)을 각각 조건 추가로 해결하려 했고, "최소 force law로 설명되는가"를 pass/fail 기준에 두지 않았다.
  - nonblank canvas/browser smoke는 custom force 누적의 UX 불안정과 internal link mismatch를 충분히 잡지 못했다.
- Permanent guardrail:
  - Obsidian 동등성만 명시된 referral graph 작업에서는 runtime force를 기본적으로 `charge/link/x/y` 네 개로 제한한다.
  - 사용자가 cluster 구분, parent-child pinwheel, drag edge stretch 제한처럼 별도 shape guarantee를 우선하면 v14처럼 hybrid helper force를 사용할 수 있지만, current contract/docs/test checklist에 force 목록과 금지 항목을 먼저 반영한다.
  - `react-force-graph-2d`에서는 기존 internal `link` force를 가져와 설정만 바꾸고, 새 `forceLink(graphData.links)`를 임의로 주입하지 않는다.
- Related files:
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-layout.ts`
  - `web/src/app/dashboard/referrals/graph/page.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts web/src/lib/referral-graph-display.test.ts web/src/lib/referral-graph-highlight.test.ts`
  - `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/app/dashboard/referrals/graph/page.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-layout.ts src/types/referral-graph.ts src/types/d3-force.d.ts`
  - `cd web && npm run build`
  - Browser QA screenshot: `.codex/harness/referral-graph-obsidian-v7-browser-qa.png`

## 2026-04-25 | Admin Referral Graph | directed hierarchy를 무시한 degree-only edge length로 branch child ring 공간을 놓침
- Symptom:
  - 자식을 가진 자식 노드가 leaf sibling과 같은 edge length로 묶여, 중간 부모 주변의 하위 노드 ring이 부모/형제 edge와 섞이며 깨져 보였다.
  - 실제 브라우저 synthetic nested tree에서 최초 자동 fit도 너무 이른 시점에 잡혀, 안정화 후 graph가 캔버스 하단으로 밀리는 문제가 함께 드러났다.
- Root cause:
  - `getReferralGraphLinkForceConfig(...)`가 `sourceDegree/targetDegree`만 보고 link target distance를 계산해, target node가 다시 children을 가진 branch인지 구분하지 못했다.
  - 초기 seed도 같은 child ring radius를 leaf child와 branch child에 적용해 branch subtree가 펼쳐질 bridge 공간을 예약하지 않았다.
  - 최초 fit은 seed 기준으로 한 번만 잡혀, link/charge/fanout 안정화 뒤 넓어진 bounds를 다시 반영하지 못했다.
- Why it was missed:
  - parent-child ring 테스트가 "부모 주변 자식"까지만 다뤘고, `parent -> branch child -> grandchildren` 형태의 nested branch simulation/browser QA가 없었다.
  - 브라우저 QA를 nonblank 중심으로만 보면 화면 하단으로 밀린 bounds나 branch/leaf edge length 차이를 놓칠 수 있다.
- Permanent guardrail:
  - 추천인 그래프 link distance는 directed hierarchy metadata(`sourceOutDegree`, `targetOutDegree`, in-degree)를 함께 받아야 한다.
  - direct child가 다시 children을 가진 branch node이면 leaf sibling보다 긴 bridge target distance를 가져야 하며, layout seed도 같은 법칙으로 공간을 예약해야 한다.
  - 브라우저 QA는 synthetic nested branch graph를 띄우고, 수동 `화면 맞춤` 없이 node pixel bounds가 캔버스 안에 들어오는지 확인한다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/lib/referral-graph-layout.ts`
  - `web/src/lib/referral-graph-layout.test.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-layout.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`
  - Browser QA screenshot: `.codex/harness/referral-graph-nested-branch-auto-fit-qa.png`

## 2026-04-25 | Admin Referral Graph | parent-child 원형을 별도 absolute ring force로 보정해 Obsidian식 core force 계약을 흐림
- Symptom:
  - 상위 노드 주변에 하위 노드가 원형처럼 보이길 원했지만, 실제 화면에서는 여전히 일부 하위 노드가 부모에게 너무 붙거나 선형으로 보였다.
  - 이전 수정은 `parent-ring` 보정 force를 추가했지만, 사용자가 기대한 Obsidian식 link/repel/center 중심 물리와 다르게 별도 목표점 force가 runtime 모양을 따로 지배할 수 있었다.
- Root cause:
  - 부모-자식 spoke의 d3 link target distance 자체가 약 96px 수준으로 짧아 이름 label이 있는 관리자 화면에서 원형 구조로 읽히기 어려웠다.
  - 핵심 link spring을 label-readable 거리로 고치기보다 parent-ring force를 덧붙여 증상을 보정하려 했다.
- Why it was missed:
  - "하위 노드가 원형으로 보인다"는 요구를 link force 계약으로 환원하지 않고, 별도 모양 유지 force로 처리했다.
  - 테스트도 parent-ring force 존재를 통과 조건으로 삼아 Obsidian식 core force 모델과 멀어지는 것을 잡지 못했다.
- Permanent guardrail:
  - Graph View식 물리는 먼저 `center/repel/link/linkDistance/alpha` core force로 설명 가능한지 확인한다.
  - 부모-자식 star 반경은 d3 link force의 target distance가 책임져야 하며, angular separation은 edge 겹침을 줄이는 보조 additive force로만 둔다.
  - 별도 absolute node target force를 추가할 때는 기존 link spring을 우회하거나 이기지 않는지 테스트에 "absolute ring/tether 없이 core forces만으로 유지" 케이스를 넣는다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`

## 2026-04-25 | Admin Referral Graph | parent-child 원형 요구를 seed 테스트만으로 닫아 runtime force에서 풀리는 문제를 놓침
- Symptom:
  - 사용자는 하위 노드가 상위 노드를 원형으로 둘러싸길 원했지만, 실제 브라우저에서는 몇 초 안정화 후 하위 노드가 한쪽으로 늘어진 일반 force layout처럼 보였다.
  - 첨부 화면에서 `문주화`, `김인경` 주변 하위 노드가 상위 노드 주변 원형 ring이 아니라 선형/편향 cluster로 멈췄다.
- Root cause:
  - `referral-graph-layout`에서 초기 seed만 parent-centered ring으로 만들었고, 런타임 d3 force에는 그 ring을 유지하는 parent-child force가 없었다.
  - 기존 hub fanout도 undirected adjacency를 써서 상위 노드가 하위 hub의 neighbor로 같이 밀리는 역방향 왜곡을 만들 수 있었다.
- Why it was missed:
  - 회귀 테스트가 layout helper의 초기 좌표만 검증했고, d3 force 안정화 후의 실제 화면 계약을 검증하지 않았다.
  - synthetic browser QA도 canvas nonblank 위주였고, parent-child ring 유지 자체를 force-level acceptance로 고정하지 않았다.
- Permanent guardrail:
  - graph layout UX 요구는 seed 좌표 테스트만으로 닫지 않는다. 안정화 후에도 유지돼야 하는 모양이면 d3 custom force 테스트를 함께 추가한다.
  - 추천인 그래프의 fanout/ring force는 directed `source -> target` edge를 기본으로 삼고, 특별한 이유 없이 undirected adjacency를 쓰지 않는다.
  - 브라우저 QA에서 보이는 구조 요구는 pixel nonblank 외에 force helper 계약 또는 geometry assertion으로 보강한다.
- Related files:
  - `web/src/lib/referral-graph-physics.ts`
  - `web/src/lib/referral-graph-physics.test.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`

## 2026-04-23 | Codex App / Visible Browser Demo | 이미 열린 IAB 탭을 이 Windows 세션에서 직접 조작할 수 있다고 사용자 기대를 충분히 일찍 정리하지 않음
- Symptom:
  - 사용자는 Codex 앱 안의 현재 IAB 화면이 내가 직접 움직이는 것처럼 보이길 원했지만, 나는 별도 자동화 세션과 IAB 직접 제어를 여러 번 구분 설명해야 했다.
  - 결과적으로 테스트는 됐어도, "같은 화면을 내가 직접 움직인다"는 기대와 실제 가능한 경로 사이에 마찰이 생겼다.
- Root cause:
  - 현재 Windows Codex 세션에는 이미 열린 IAB pane을 agent가 직접 클릭하는 툴 훅이 없는데, 이 제약과 대체 경로를 초기에 더 선명하게 못 박지 않았다.
  - visible demo 요구를 받았을 때, 먼저 "IAB 직접 제어 불가 / 별도 headed browser 가능"을 즉시 실행 계획으로 고정하지 않았다.
- Why it was missed:
  - `localhost:3200`을 실제로 조작 가능한지 확인하는 쪽에 집중하면서, 사용자 관점의 "같은 화면에서 보여야 한다"는 기대를 도구 경계 기준으로 먼저 명확히 정리하지 못했다.
- Permanent guardrail:
  - Windows Codex 세션에서 사용자가 "내가 보는 화면을 네가 직접 움직여라"라고 요청하면, 먼저 현재 IAB direct-control 훅 유무를 분명히 말한다.
  - direct IAB control이 없으면 바로 `headed Playwright visible window against the same localhost URL`를 대안으로 제시하고, 그 차이를 한 문장으로 고정한다.
  - visible demo를 재현할 때는 `slowMo`와 명시적 대기 시간을 넣어 사용자가 실제 클릭 흐름을 눈으로 볼 수 있게 한다.
- Related files:
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `http://localhost:3200/login` headed Playwright visible run
  - `회원가입` 클릭 후 `/signup`
  - `비밀번호 변경하기` 클릭 후 `/reset-password`

## 2026-04-23 | Codex App / Windows Run Wiring | `bash`가 곧 Git Bash일 것이라고 가정하고, 포트 점유 확인도 IPv4 localhost만 봐서 local preview wiring을 두 번 틀림
- Symptom:
  - Codex run action을 `bash ./script/build_and_run.sh`로 묶었더니 이 Windows 세션에서는 `bash`가 Git Bash가 아니라 WSL shim을 가리켜 바로 실패했다.
  - 그 다음엔 Expo web startup을 자동 포트 선택으로 고쳤다고 생각했지만, 8081을 `::`에 잡고 있는 기존 `node` listener를 IPv4 `127.0.0.1` probe가 놓쳐서 non-interactive port prompt에 다시 걸렸다.
- Root cause:
  - Windows에서 `bash` resolution을 실제 경로로 검증하지 않고 일반 Unix-like 전제를 그대로 적용했다.
  - free-port detection을 `127.0.0.1` bind로만 검사해 system-wide/IPv6 listener 충돌을 잡지 못했다.
- Why it was missed:
  - run-action wiring을 문서 reference 그대로 적용하면 될 것이라 보고, 이 머신의 shell resolution과 현재 listen socket 상태를 먼저 점검하지 않았다.
- Permanent guardrail:
  - Windows에서 Codex run action을 만들 때는 `Get-Command bash` 결과를 먼저 확인하고, WSL shim이면 Git Bash 절대경로를 action command에 쓴다.
  - Expo/Metro free-port detection은 IPv4 localhost만 보지 말고 system-wide bind 기준으로 검사한다.
  - screenshot-style Codex demo를 재현하려면 native emulator보다 `Run Web + Browser pane + localhost URL` 경로를 먼저 검증한다.
- Related files:
  - `.codex/environments/environment.toml`
  - `script/build_and_run.sh`
  - `.codex/harness/qa-report.md`
- Verification:
  - `Get-Command bash`
  - `C:\Program Files\Git\bin\bash.exe ./script/build_and_run.sh --web`
  - startup log `Waiting on http://localhost:3200`

## 2026-04-23 | Governance / Push Diff Range | PR green만 확인하고 push workflow가 보는 마지막 푸시 diff를 같은 기준으로 닫지 않음
- Symptom:
  - `pull_request` governance는 green으로 돌아왔는데, 바로 뒤의 `push` governance는 `1084f1b..6e73da6` 범위에서 handbook owner 문서 누락으로 다시 실패했다.
  - 사용자는 같은 브랜치에서 또 빨간 governance run을 보게 됐다.
- Root cause:
  - `path-owner-map` coverage만 고치고 멈췄고, 마지막 커밋에 포함된 referral/admin-web 코드 묶음에 대응하는 owner handbook 문서를 같은 commit에서 업데이트하지 않았다.
  - 즉 PR 전체 diff와 마지막 push diff가 governance에서 서로 다른 범위라는 점을 검증 루틴에 넣지 않았다.
- Why it was missed:
  - `pull_request` run이 green으로 바뀐 순간 closeout이 끝났다고 판단했고, `push` event run 로그를 즉시 다시 확인하지 않았다.
- Permanent guardrail:
  - handbook-sensitive 코드가 들어간 commit을 새로 푸시할 때는 `node scripts/ci/check-governance.mjs`만 끝내지 말고, 푸시 후 `gh run list --branch <branch>`에서 최신 `push`와 `pull_request` governance 둘 다 확인한다.
  - referral/schema/admin-web 같은 owner-mapped 영역을 건드리는 commit은 관련 handbook owner 문서를 같은 commit에 포함시키기 전까지 closeout으로 보고하지 않는다.
- Related files:
  - `docs/handbook/data/referral-schema-and-admin-rpcs.md`
  - `docs/handbook/data/data-model-canon.md`
  - `docs/handbook/shared/security-and-secret-operations.md`
  - `docs/handbook/admin-web/dashboard-lifecycle.md`
  - `.github/workflows/governance-check.yml`
- Verification:
  - `gh run view 24821626525 --repo jj8127/Appointment-Process --log-failed`
  - handbook owner 문서 보강 후 새 push/pull_request governance 재확인

## 2026-04-23 | Governance / PR Diff Range | 로컬 현재 작업 단위만 보고 PR 전체 diff 기준 governance를 다시 확인하지 않음
- Symptom:
  - 로컬에서는 방금 만진 파일 위주 검증만 통과한 뒤 커밋/상태 보고를 했는데, GitHub PR governance는 브랜치 전체 diff에서 `path-owner-map` 누락으로 계속 실패했다.
  - 특히 `remote HEAD`와 `local unpushed commit`을 분리해서 설명하지 못해, 사용자는 같은 governance 실패를 반복해서 보게 됐다.
- Root cause:
  - 검증 대상을 `현재 작업 파일`로 좁혀서 봤고, 실제 CI가 보는 `BASE_SHA...HEAD_SHA` PR diff 범위를 같은 기준으로 재현하지 않았다.
  - `supabase/functions/_shared/*` helper/test처럼 handbook-sensitive path가 새로 늘었는데, `docs/handbook/path-owner-map.json` coverage를 branch 전체 기준으로 재점검하지 않았다.
- Why it was missed:
  - 로컬 `node scripts/ci/check-governance.mjs` 1회 통과만 믿고, CI 로그의 exact failing head SHA와 PR 전체 diff를 다시 비교하지 않았다.
  - “이번 커밋”과 “이미 브랜치에 남아 있는 미커밋/미푸시 변경”을 같은 검증 세트로 묶어 생각하지 못했다.
- Permanent guardrail:
  - governance 이슈를 다룰 때는 항상 `remote failing HEAD`, `local HEAD`, `working tree`를 분리해서 먼저 적는다.
  - push 전에는 반드시 PR base SHA를 명시해서 같은 range로 governance를 재실행한다.
  - `supabase/functions/_shared/*` 같은 shared helper를 추가하면 같은 세션에서 `docs/handbook/path-owner-map.json`도 같이 grep 검토한다.
- Related files:
  - `scripts/ci/check-governance.mjs`
  - `docs/handbook/path-owner-map.json`
  - `.claude/MISTAKES.md`
- Verification:
  - `gh run view <run-id> --repo jj8127/Appointment-Process --log`
  - `git diff --name-only <base-sha>...HEAD`
  - `$env:BASE_SHA='<base>'; $env:HEAD_SHA=(git rev-parse HEAD); node scripts/ci/check-governance.mjs`

## 2026-04-23 | Manager FC Visibility Contract | 대상 목록 가시성 규칙만 바꾸고 허브 unread 집계를 옛 기준으로 남겨 숫자/목록이 서로 어긋남
- Symptom:
  - 본부장에게 전체 FC를 보이도록 목록 계약을 넓힌 뒤에도, 관리자 웹 메신저 허브 unread badge는 기존 raw `messages` 기준을 계속 써서 보이는 대상 범위와 숫자가 어긋날 수 있었다.
- Root cause:
  - “누가 보이는가”와 “누구의 unread를 셀 것인가”가 같은 participant filter를 공유하지 않았다.
  - 내부 메신저 범위 변경을 모바일 list/unread와 웹 chat list에는 반영했지만, 웹 messenger hub count surface까지 같은 계약으로 묶지 못했다.
- Why it was missed:
  - acceptance criterion을 메인 화면(모바일 내부 메신저, 웹 채팅) 중심으로 닫고, 허브 badge 같은 파생 surface를 독립적으로 재점검하지 않았다.
- Permanent guardrail:
  - participant scope가 바뀌는 기능은 `목록 + unread badge + 허브 요약 + deep-link 진입`을 하나의 계약 세트로 검토한다.
  - unread badge는 raw table count를 직접 세기보다, 같은 participant helper/RPC contract를 쓰는 요약 경로를 우선 사용한다.
- Related files:
  - `supabase/functions/_shared/internal-chat.ts`
  - `supabase/functions/fc-notify/index.ts`
  - `web/src/app/dashboard/chat/page.tsx`
  - `web/src/app/dashboard/messenger/page.tsx`
- Verification:
  - `npm test -- --runInBand lib/__tests__/internal-chat.test.ts`
  - `cd E:\\hanhwa\\fc-onboarding-app\\web && npm run lint -- src/app/dashboard/chat/page.tsx src/app/dashboard/messenger/page.tsx src/lib/admin-chat-targets.ts src/lib/admin-chat-targets.test.ts`
  - `cd E:\\hanhwa\\fc-onboarding-app\\web && npx next build`

## 2026-04-23 | Invite-Link Signup Search | exact 추천코드 deeplink를 fuzzy search 경로와 재귀 pending-apply에 그대로 태워 첫 진입 체감과 안정성을 같이 망침
- Symptom:
  - 초대링크 exact 8자리 추천코드 진입이 불필요하게 느렸고, signup 화면에서 같은 pending code apply가 중복 예약될 수 있었다.
  - 사용자는 추천인 코드 검색이 오래 걸리거나 앱이 튕기는 것처럼 느꼈다.
- Root cause:
  - `search-signup-referral`이 exact code query도 broad name/affiliation/code 부분검색 경로로 처리했다.
  - `app/signup.tsx`의 pending apply는 in-flight promise가 있을 때 `finally(() => applyPendingReferralCode())`를 다시 붙여 중복 rerun을 만들 수 있었다.
- Why it was missed:
  - signup search rollout 때 “검색 계약이 동작한다”는 것만 닫고, exact 8자리 invite-link query latency와 cold/warm start 중복 apply를 별도 acceptance criterion으로 두지 않았다.
- Permanent guardrail:
  - exact 8자리 추천코드 query가 있는 검색 API는 fuzzy search 전에 exact fast path 유무를 먼저 검토한다.
  - deep-link/pending code auto-apply는 focus/effect 중복 트리거가 있어도 single-flight로만 돌게 만들고, `finally` 재귀 rerun 패턴을 다시 쓰지 않는다.
- Related files:
  - `app/signup.tsx`
  - `lib/signup-referral.ts`
  - `lib/__tests__/signup-referral.test.ts`
  - `supabase/functions/search-signup-referral/index.ts`
  - `supabase/functions/_shared/referral-search.ts`
  - `supabase/functions/_shared/__tests__/referral-search.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/signup-referral.test.ts`
  - `npm test -- --runInBand supabase/functions/_shared/__tests__/referral-search.test.ts`
  - `supabase functions deploy search-signup-referral --project-ref ubeginyxaotcamuqpmud`

## 2026-04-23 | Referral Current-State Contract | current-state와 historical evidence를 둘 다 live 상태처럼 노출해 UI/문서가 내부 저장 구조를 그대로 드러냄
- Symptom:
  - 추천인 그래프가 `structured/confirmed/structured_confirmed` 같은 내부 근거 상태를 그대로 드러냈고, self-service/read model도 일부는 structured link, 일부는 attribution/history를 함께 해석하고 있었다.
  - 운영자 관점에서는 같은 추천 관계가 “현재 상태” 하나가 아니라 여러 색/용어로 갈라져 보였다.
- Root cause:
  - current-state와 audit/history를 분리 저장하는 것 자체는 맞았지만, read model/UI에서 그 차이를 감추지 못했다.
  - 저장 경로도 단일 RPC contract로 묶기 전에 여러 source를 병렬로 업데이트하던 관성이 남아 있었다.
- Why it was missed:
  - DB 설계에서 “상태 1개 + 감사 이력”과 “dual-state UI”를 명확히 구분하지 않았다.
  - 관리자 그래프를 운영자 도구가 아니라 내부 데이터 디버거처럼 취급한 흔적이 남았다.
- Permanent guardrail:
  - 추천인 current-state는 `fc_profiles.recommender_*` snapshot만 UI/read model이 사용한다.
  - `referral_attributions` 같은 historical data는 archive/audit 용도일 뿐, 새 runtime edge/state source로 다시 끌어오지 않는다.
  - current-state 변경은 모두 `apply_referral_link_state(...)` 같은 단일 RPC로 묶고, 하나라도 실패하면 current-state/event 어느 쪽도 부분 저장하지 않는 계약을 유지한다.
- Related files:
  - `supabase/migrations/20260423000001_unify_referral_link_state.sql`
  - `supabase/functions/_shared/referral-link.ts`
  - `supabase/functions/set-password/index.ts`
  - `supabase/functions/update-my-recommender/index.ts`
  - `web/src/lib/admin-referrals.ts`
  - `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification:
  - `node --experimental-strip-types --test E:\\hanhwa\\fc-onboarding-app\\web\\src\\lib\\referral-graph-edges.test.ts`
  - `cd E:\\hanhwa\\fc-onboarding-app\\web && npm run build`
  - `cd E:\\hanhwa\\fc-onboarding-app && node scripts/ci/check-governance.mjs`

## 2026-04-22 | Admin Web Vercel Deployment Contract | preview env drift를 production fallback과 silent fallback으로 숨겨 live 서비스와 섞이게 둠
- Symptom:
  - 관리자 웹 preview 배포에서 `설계요청 메신저`가 명시적 URL env 없이도 live `requestboard-steel`로 열릴 수 있었다.
  - web push와 주민번호 조회도 env 누락 시 generic failure 또는 조용한 fallback으로만 보여, preview 배포가 무엇을 검증 중인지 구분하기 어려웠다.
- Root cause:
  - 외부 운영 시스템 URL과 보안 env 부재를 “일단 동작하게 하는 fallback”으로 흡수했다.
  - 그 결과 preview/prod 경계가 코드와 Vercel env 계약에 명시되지 않았고, drift가 사용자-visible 문제로 늦게 드러났다.
- Why it was missed:
  - build 통과와 일부 기능 동작만 보고, preview가 live 외부 시스템이나 edge fallback을 암묵적으로 타는지를 acceptance criterion으로 고정하지 않았다.
  - env가 빠졌을 때 `막아야 하는 기능`과 `살려도 되는 fallback`을 구분하지 않았다.
- Permanent guardrail:
  - preview에서 운영 외부 시스템으로 이어지는 URL은 fallback으로 열지 않는다. env가 없으면 명시적으로 비활성화한다.
  - web push, 주민번호 같은 운영 민감 기능은 missing env를 generic failure로 숨기지 말고, 어떤 env가 빠졌는지 또는 어떤 fallback source를 탔는지 로그/운영 문구에 남긴다.
  - Vercel env drift를 고칠 때는 코드 가드와 env 변경을 같은 세트로 처리하고, `vercel env ls preview|production` 결과를 검증 증적에 포함한다.
- Related files:
  - `web/src/app/dashboard/messenger/page.tsx`
  - `web/src/lib/request-board-url.ts`
  - `web/src/components/WebPushRegistrar.tsx`
  - `web/src/lib/web-push-config.ts`
  - `web/src/lib/web-push.ts`
  - `web/src/lib/server-resident-numbers.ts`
- Verification:
  - `vercel env ls preview --cwd E:\\hanhwa\\fc-onboarding-app\\web`
  - `vercel env ls production --cwd E:\\hanhwa\\fc-onboarding-app\\web`
  - `cd web && npm run lint -- ...`
  - `cd web && npm run build`

## 2026-04-22 | Referral Report Export | 전화번호 CSV를 plain number로만 내보내 스프레드시트가 과학적 표기법으로 바꾸는 문제를 놓침
- Symptom:
  - `fc-missing-recommender-2026-04-22.csv`를 엑셀/스프레드시트로 열면 `010...` 전화번호가 `1.029E+09` 같은 과학적 표기법으로 보였다.
- Root cause:
  - CSV 본문은 raw 숫자 문자열로 맞게 저장됐지만, spreadsheet import/open 동작이 전화번호 열을 숫자로 자동 추론한다는 소비 환경 계약을 export 단계에서 반영하지 않았다.
- Why it was missed:
  - 데이터 조회 정확도만 확인하고, 실제 전달 포맷이 사용자의 기본 열기 도구(엑셀/스프레드시트)에서 어떻게 보이는지는 acceptance criterion에 넣지 않았다.
- Permanent guardrail:
  - 전화번호/주민번호처럼 앞자리 0이 의미를 갖는 보고서 CSV는 기본 export를 spreadsheet-safe text 형식으로 저장하고, 필요하면 raw CSV를 별도 파일로 같이 만든다.
  - 보고서 산출물은 생성 직후 첫 몇 줄을 다시 읽어 phone column formatting contract를 확인한다.
- Related files:
  - `scripts/reporting/export-missing-recommender-report.mjs`, `.codex/harness/reports/fc-missing-recommender-2026-04-22.csv`
- Verification:
  - `npm run report:missing-recommender -- --date=2026-04-22`
  - `Get-Content .codex\\harness\\reports\\fc-missing-recommender-2026-04-22.csv -TotalCount 5`

## 2026-04-20 | Android Dev QA Network Baseline | backend smoke만 믿고 emulator DNS/Metro 상태를 런타임 전제조건으로 먼저 고정하지 않아 로그인/불러오기 실패를 코드 문제처럼 오진함
- Symptom:
  - Android dev client에서 로그인, `latest_notice`, 시험 정보/신청자 정보 등 외부 fetch가 랜덤하게 실패했고, `FunctionsFetchError`와 `expo-notifications` network warning이 연속으로 보였다.
  - 같은 세션에서 `Loading from 172.28.4.60:8082...` blank screen, `Feather.ttf` asset fetch 실패, generic login failure alert가 뒤섞여 원인 분리가 어려웠다.
- Root cause:
  - 실제 1차 원인은 emulator DNS가 깨져 있어 `google.com`, `*.supabase.co`, `*.vercel.app` host resolution이 실패한 상태였다.
  - 동시에 dev client가 이전 Metro endpoint(`172.28.4.60:8082`)를 요구하는 상태였는데 Metro가 떠 있지 않은 순간도 있어, font asset fetch 실패가 추가로 섞였다.
  - 나는 backend `login-with-password`/`bridge-login` smoke만 보고 앱 런타임 network baseline을 같은 acceptance criterion으로 묶지 않았다.
- Why it was missed:
  - auth backend 정상 여부와 Android emulator runtime 정상 여부를 분리하지 않고, 먼저 backend를 확인한 뒤 client post-login 코드만 의심했다.
  - emulator에서 host-resolution(`ping google.com`)과 Metro binding 상태를 초기에 확인하지 않아, 환경 문제를 코드 회귀처럼 추적했다.
- Permanent guardrail:
  - Android dev QA 시작 전에 `google.com`, Supabase host, request_board host DNS resolution과 active Metro endpoint를 먼저 확인한다.
  - backend smoke 통과만으로 모바일 로그인 회귀를 닫지 않는다. 최소 1회는 emulator/device에서 실제 fetch contract를 확인한다.
  - emulator를 재기동할 때 DNS가 흔들리면 `-dns-server 8.8.8.8,1.1.1.1`로 띄우고 그 상태를 QA note에 남긴다.
- Related files:
  - `.codex/harness/evidence/android-optimization-pass1/*`, `.codex/harness/qa-report.md`, `.codex/harness/handoff.md`
- Verification:
  - emulator relaunch: `emulator.exe -avd codex-api34 -dns-server 8.8.8.8,1.1.1.1`
  - `adb shell ping -c 1 google.com`
  - `adb shell ping -c 1 ubeginyxaotcamuqpmud.functions.supabase.co`
  - `adb shell ping -c 1 requestboard-steel.vercel.app`

## 2026-04-20 | Mobile Login Post-Success Flow | 로그인 성공 직후 공용 로더/라우팅/푸시 등록을 한 번에 붙여 post-login 안정화를 깨뜨림
- Symptom:
  - `login-with-password` 자체는 성공하는데도 앱에서 로그인 직후 다시 실패처럼 보이거나, dev build에서는 `ExpoAsset.downloadAsync` / `Feather.ttf` asset 오류가 로그인 버튼 loading 순간에 터졌다.
  - 실제 기기 로그에서는 `expo-notifications` push token update 경고가 연속으로 찍혀 로그인 실패 원인처럼 보였다.
- Root cause:
  - 로그인 성공 직후 가장 먼저 렌더되는 공용 loading spinner를 `@expo/vector-icons/Feather` 기반으로 바꿔, 아직 해당 폰트 asset을 확보하지 못한 dev client/runtime에서 login pending 자체가 예외 트리거가 됐다.
  - 동시에 `useLogin`이 session state propagation 전에 landing route로 직접 `router.replace(...)`를 호출했고, 홈 계열 화면은 `role`이 아직 반영되기 전이면 `/login`으로 즉시 되돌아가는 보호 effect를 갖고 있어 post-login route race가 생길 수 있었다.
  - 여기에 push token 등록도 session 확정 직후 바로 시도돼 네트워크 경고가 겹치면서 원인 판별을 더 어렵게 만들었다.
- Why it was missed:
  - backend auth 응답이 정상인 것을 확인하고도, "로그인 성공 후 첫 pending UI"와 "session-driven route transition"을 같은 계약으로 다시 보지 않았다.
  - 공용 primitive 변경을 login surface에 적용하면서 font asset dependency와 protected-route redirect race를 별도 acceptance criterion으로 고정하지 않았다.
- Permanent guardrail:
  - 로그인/초기 진입에 걸리는 공용 loading primitive는 font-backed icon이 아니라 asset-free primitive(SVG/ActivityIndicator/native shape)로 둔다.
  - login mutation은 session state만 갱신하고, landing navigation은 session observer screen이 담당하게 해 protected-route guard와 순서를 맞춘다.
  - push token 등록 같은 비핵심 side effect는 login success와 같은 frame에서 바로 실행하지 말고, session 확정 뒤 지연/중복방지 key를 둔다.
- Related files:
  - `components/BrandedLoadingSpinner.tsx`, `lib/branded-loading-spinner.ts`, `hooks/use-login.ts`, `app/login.tsx`, `hooks/use-session.tsx`, `lib/session-landing.ts`, `lib/push-registration.ts`
- Verification:
  - `npm test -- --runInBand components/__tests__/BrandedLoadingSpinner.contract.test.ts lib/__tests__/branded-loading-spinner.test.ts hooks/__tests__/use-login.contract.test.ts lib/__tests__/session-landing.test.ts lib/__tests__/push-registration.test.ts`
  - direct backend smoke: `login-with-password` + request_board `bridge-login` both succeed for provided FC/admin credentials

## 2026-04-20 | Shared Loading UX Rollout | 메신저에 loading motion을 넣고도 나머지 `ActivityIndicator` surface를 같은 change set에서 바로 감사하지 않아 사용자에게 "왜 여긴 아직도 기본 spinner냐"는 불연속성을 남김
- Symptom:
  - 메신저 쪽에는 animated loading card가 보이는데, 홈/시험/설계요청/저장 버튼/추천인 검색 등 다른 화면은 여전히 bare spinner만 보여 UX가 불균일했다.
  - 사용자가 직접 "모두 바꿔"라고 다시 요청할 정도로 공용 treatment처럼 보이지 않았다.
- Root cause:
  - 새 loading treatment를 messenger-specific polish로 먼저 적용했고, `app/*`, `components/*`의 باقي `ActivityIndicator` occurrences를 같은 도메인 rollout 범위로 즉시 승격하지 않았다.
  - 공용 primitive를 먼저 만들지 않고 screen-by-screen로 시작해, 최초 적용 범위가 자연스럽게 전체 계약으로 이어지지 않았다.
- Why it was missed:
  - "새 패턴이 잘 보이는 대표 화면 2곳"에 먼저 넣는 것과 "앱 전역 공용 loading 계약을 바꾸는 것"을 같은 수준의 완료 조건으로 착각했다.
  - 정적 검색으로 남은 `ActivityIndicator` surface를 세지 않은 상태에서 initial rollout을 사실상 닫았다.
- Permanent guardrail:
  - 새 공용 UI treatment를 도입할 때는 대표 화면만 바꾸지 말고, 먼저 codebase-wide occurrence scan으로 적용 대상을 전부 나열한 뒤 rollout 범위를 정한다.
  - `app/*`, `components/*`에 남은 legacy primitive count(`ActivityIndicator`, old badge, old header 등)를 검색으로 0 또는 intentional-allowlist 상태까지 확인한 뒤에만 "공용 전개 완료"로 본다.
  - 공용 motion/loading는 screen-specific component가 아니라 shared primitive부터 만들고, wrapper는 그 다음에 둔다.
- Related files:
  - `components/BrandedLoadingState.tsx`, `components/BrandedLoadingSpinner.tsx`, `lib/messenger-loading.ts`, `lib/branded-loading-spinner.ts`, `app/*`, `components/*`
- Verification:
  - `npm test -- --runInBand lib/__tests__/messenger-loading.test.ts lib/__tests__/branded-loading-spinner.test.ts`
  - `Get-ChildItem app,components -Recurse -Include *.tsx,*.ts | Select-String 'ActivityIndicator'`

## 2026-04-20 | Mobile Messenger Navigation Parity | 메신저 최적화/QA 중 route header와 screen header를 따로 보다가 두 화면의 뒤로가기 노출 계약을 놓침
- Symptom:
  - `메신저` 화면 상단 헤더에 뒤로가기 버튼이 보이지 않았다.
  - `가람지사 메신저` 화면도 내부 헤더에 뒤로가기 버튼이 없어 상단에서 복귀할 수 없었다.
- Root cause:
  - `메신저`는 `app/_layout.tsx`의 Stack header에 의존하고, `가람지사 메신저`는 화면 내부 커스텀 헤더를 쓰는 서로 다른 구조인데, 메신저 최적화 동안 이를 하나의 navigation cluster로 다시 대조하지 않았다.
  - 특히 `메신저`는 stack back이 없는 진입에서도 back affordance가 필요한데 default header back에만 기대고 있었다.
- Why it was missed:
  - 성능 리팩터와 unread 정확도 검증에 집중하면서, top-header navigation parity를 explicit QA 항목으로 고정하지 않았다.
  - 정적 lint/test는 route header 노출 여부를 직접 잡아주지 못하는데도 화면 QA 이전에 닫으려 했다.
- Permanent guardrail:
  - 메신저 도메인 수정 시 `app/_layout.tsx`, `app/messenger.tsx`, `app/admin-messenger.tsx`, `app/chat.tsx`를 하나의 navigation cluster로 보고 header/back parity를 함께 점검한다.
  - 스택이 없을 수 있는 top-level route는 default back에만 기대지 말고 fallback route를 가진 explicit back action을 둔다.
  - manual QA checklist에 `상단 헤더 뒤로가기 버튼 보임 + 동작`을 별도 항목으로 넣는다.
- Related files:
  - `app/_layout.tsx`, `app/admin-messenger.tsx`, `app/messenger.tsx`, `lib/back-navigation.ts`, `lib/__tests__/back-navigation.test.ts`
- Verification:
  - `npm test -- --runInBand lib/__tests__/back-navigation.test.ts`
  - `npx eslint app/_layout.tsx app/admin-messenger.tsx lib/back-navigation.ts lib/__tests__/back-navigation.test.ts`

## 2026-04-20 | Signup Referral Search Rollout | 회원가입 추천인 검색을 `/referral`과 같은 계약으로 바꾸면서 배포/선택 게이트를 끝까지 닫지 않아 "검색 결과 없음"으로 보이게 둠
- Symptom:
  - 회원가입 화면에서 추천인 UI는 검색형처럼 보이는데, 이름 검색이 계속 `검색 결과가 없어요`로만 보였다.
  - 추천인 입력도 direct code input과 search input이 둘로 갈라져 `/referral`과 다른 사용 경험이 남아 있었다.
- Root cause:
  - signup surface가 여전히 `직접 코드 입력 + 보조 검색` 계약에 머물러 있었고, pasted 8자리 코드도 결과 선택 없이 바로 검증/저장 경로로 들어갔다.
  - 동시에 unauthenticated 검색용 Edge Function `search-signup-referral`은 local source에만 있고 원격 project(`ubeginyxaotcamuqpmud`)에는 배포되지 않아, 클라이언트는 function failure를 empty result처럼 보이게 삼켰다.
- Why it was missed:
  - `/referral` parity를 UI/코드 관점으로만 봤고, signup trusted search path의 actual deployment 상태와 empty/error 분리를 같은 acceptance criterion으로 고정하지 않았다.
  - "검색 입력이 보인다"와 "검색 contract가 실제 런타임에서 동작한다"를 별개로 검증하지 않았다.
- Permanent guardrail:
  - signup과 `/referral` 추천인 입력은 같은 도메인 계약으로 보고, 검색형 surface라면 `단일 입력`, `검색 결과 선택 필수`, `typed/pasted code도 selection gate 통과`를 함께 묶어 검토한다.
  - 새 trusted Edge Function을 client에 연결할 때는 UI 반영만으로 닫지 않는다. 같은 세션에서 `functions list/deploy`와 live invoke까지 확인하고, client는 function failure를 empty state로 숨기지 않는다.
- Related files:
  - `app/signup.tsx`, `components/ReferralSearchField.tsx`, `lib/signup-referral.ts`, `lib/__tests__/signup-referral.test.ts`, `supabase/functions/search-signup-referral/index.ts`, `docs/referral-system/SPEC.md`
- Verification:
  - `npm test -- --runInBand lib/__tests__/signup-referral.test.ts`
  - `npx eslint app/signup.tsx components/ReferralSearchField.tsx lib/signup-referral.ts lib/__tests__/signup-referral.test.ts`
  - `supabase functions deploy search-signup-referral --project-ref ubeginyxaotcamuqpmud`
  - live anon invoke: exact code query + name query both return `200` results from `search-signup-referral`

## 2026-04-17 | Referral Code Provisioning Contract | eligible 사용자 추천코드 발급을 운영/backfill 단계로만 보고 로그인 성공 계약에 묶지 않음
- Symptom:
  - completed FC나 active manager가 정상 로그인해도 active 추천코드가 없어 바로 공유/초대를 시작하지 못했다.
  - 사용자 입장에서는 "로그인도 됐는데 왜 추천인 코드 발급을 위해 또 다른 절차가 필요하냐"는 문제로 보였다.
- Root cause:
  - `login-with-password`는 인증과 세션 발급만 처리하고, active 추천코드 보장은 관리자 backfill/수동 발급 또는 이후 별도 self-service 조회에 맡겨 두었다.
  - `get-my-referral-code`도 active code가 비어 있으면 그냥 `null`을 반환해 rollout 이전 계정이나 transient failure를 catch-up하지 않았다.
- Why it was missed:
  - 추천인 운영 관점에서 `admin_backfill_referral_codes`가 있으니 신규 로그인 사용자도 eventually code를 갖게 된다고 느슨하게 봤고, "eligible user login success = active code ready"를 별도 P0 계약으로 승격하지 않았다.
  - 로그인 성공, self-service 조회, 운영 backfill을 한 도메인 lifecycle로 연결해 검토하지 않았다.
- Permanent guardrail:
  - 사용자-facing 공유/초대 기능의 prerequisites는 로그인 성공 시점에 보장한다. eligible user가 로그인된 상태에서 추가 운영 개입이나 수동 발급 단계를 다시 밟게 두지 않는다.
  - provisioning이 인증보다 부가 기능이면 login success와 hard-couple하지 말고, 로그인 성공을 유지한 채 현재 self-service path가 1회 catch-up하도록 설계하고 테스트 케이스를 별도로 둔다.
- Related files:
  - `supabase/functions/_shared/referral-code.ts`, `supabase/functions/login-with-password/index.ts`, `supabase/functions/get-my-referral-code/index.ts`, `docs/referral-system/test-cases.json`
- Verification:
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/_shared/referral-code.ts supabase/functions/login-with-password/index.ts supabase/functions/get-my-referral-code/index.ts`
  - `node scripts/ci/check-governance.mjs`

## 2026-04-16 | Referral Self-Service Session Contract | 로그인 세션과 referral `appSessionToken`을 별도 상태로 두고 만료 복구를 정의하지 않아 로그인 사용자가 `/referral`에서 다시 인증에 막힘
- Symptom:
  - 사용자는 이미 `가람in`에 로그인돼 있는데 `/referral` 또는 추천인 저장 시 `인증이 필요합니다`가 뜨고, 추천코드 조회/변경만 막혔다.
  - 특히 오래된 세션에서는 앱 진입은 되는데 추천인 화면만 열리지 않거나 저장이 진행되지 않는 식으로 보였다.
- Root cause:
  - 로그인 유지에 쓰는 request_board bridge 세션과 referral Edge Function이 요구하는 `appSessionToken`이 분리돼 있었지만, `appSessionToken`이 없거나 만료됐을 때 bridge token으로 조용히 재발급하는 경로를 두지 않았다.
  - referral 함수들도 missing/expired/invalid app session을 모두 generic unauthorized로 뭉개 반환해, 클라이언트가 silent refresh와 재로그인 fallback을 구분할 수 없었다.
- Why it was missed:
  - self-service rollout 때 fresh login happy-path만 점검하고, `primary session valid + secondary session expired` 조합을 P0 시나리오로 고정하지 않았다.
  - 화면에 보이는 메시지만 확인하고 토큰 만료 종류별 auth code contract를 명시적으로 설계하지 않았다.
- Permanent guardrail:
  - custom secondary session이 생기면 `primary session valid / secondary session expired` 조합을 반드시 P0 케이스로 문서·테스트·런타임 QA에 넣고, silent refresh 또는 relogin fallback을 코드와 SSOT에 함께 적는다.
  - authenticated 화면은 generic unauthorized 문구 하나로 끝내지 말고 `missing_*`, `expired_*`, `invalid_*` 코드를 분리해 클라이언트 retry/logout 분기가 가능해야 한다.
- Related files:
  - `hooks/use-referral-app-session.ts`, `hooks/use-my-referral-code.ts`, `app/referral.tsx`, `supabase/functions/_shared/request-board-auth.ts`, `supabase/functions/refresh-app-session/index.ts`, `docs/referral-system/test-cases.json`
- Verification:
  - `npx eslint app/referral.tsx hooks/use-my-referral-code.ts hooks/use-referral-app-session.ts hooks/use-referral-tree.ts hooks/use-session.tsx lib/request-board-api.ts`
  - `node scripts/ci/check-governance.mjs`

## 2026-04-16 | Referral Search Contract | signup과 `/referral`의 추천인 검색 계약을 따로 굴려 회원가입 화면만 코드 입력에 고정됨
- Symptom:
  - 로그인 후 `/referral`에서는 이름/소속/추천코드 검색으로 추천인을 바꿀 수 있었지만, 비로그인 회원가입 화면은 여전히 `추천 코드 (선택)` direct input만 지원했다.
  - 사용자 입장에서는 같은 추천인 도메인인데 두 화면의 입력 방식과 안내 문구가 달라 기능이 빠진 것처럼 보였다.
- Root cause:
  - 추천인 self-service rollout을 `app/referral.tsx + search-fc-for-referral` 중심으로 진행하면서, 가입 시점 추천인 입력 surface(`app/signup.tsx`)를 같은 contract review 범위에 다시 포함하지 않았다.
  - 회원가입 검색은 비로그인 path라 별도 trusted search function이 필요했는데, 그 차이를 초기에 explicit contract로 문서화하지 않아 signup은 code-only 상태로 남았다.
- Why it was missed:
  - 추천인 기능을 `signup 확정`과 `가입 후 self-service` 두 phase로 나눠 생각하면서, 사용자-visible 입력 계약을 한 surface로 재검토하지 않았다.
  - 검토 단계에서 안내 문구만 맞는지 본 것이 아니라 기능 parity 자체를 확인했어야 했는데, 실제 runtime path 차이를 뒤늦게 확인했다.
- Permanent guardrail:
  - 추천인 입력 surface를 바꿀 때는 `signup`과 `/referral`을 같은 도메인 계약으로 묶어 검토한다. 한쪽만 검색/선택 UI를 갖고 다른 쪽은 code-only로 남겨두지 않는다.
  - 비로그인 signup path와 app-session self-service path가 다른 경우, auth 차이를 숨기지 말고 별도 trusted function을 명시적으로 두고 문서/테스트 케이스에 둘 다 적는다.
- Related files:
  - `app/signup.tsx`, `app/referral.tsx`, `supabase/functions/search-signup-referral/index.ts`, `docs/referral-system/SPEC.md`
- Verification:
  - `npm run lint -- app/signup.tsx app/referral.tsx components/ReferralSearchField.tsx`
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/search-signup-referral/index.ts`

## 2026-04-14 | Mobile Exam Applicants | dual FK embed ambiguity를 bare relation으로 읽고, query 실패를 빈 상태로 숨겨 목록 전체가 사라짐
- Symptom:
  - 가람in 본부장/총무가 `exam-manage`, `exam-manage2`를 열면 시험 신청자가 있는데도 목록이 전혀 보이지 않았다.
  - 화면은 실제 query failure를 보여주지 않고 `검색 결과가 없습니다`처럼 비어 보일 수 있었다.
- Root cause:
  - `exam_registrations`와 `exam_locations` 사이에 `location_id` FK와 `(location_id, round_id)` FK가 둘 다 생겼는데, 모바일 신청자 화면이 여전히 bare `exam_locations ( location_name )` embed를 사용했다.
  - PostgREST가 이 다중 관계를 `PGRST201`로 거절했고, `useQuery` error state를 UI에서 따로 처리하지 않아 실패가 빈 결과처럼 보였다.
- Why it was missed:
  - 직전 수정에서 `resident_id -> fc_profiles.phone` 매칭 parity에 집중하면서, 같은 query 안의 embedded relation ambiguity까지 함께 재검토하지 않았다.
  - 화면이 error state를 노출하지 않아 실제 원인을 앱에서 바로 읽기 어려웠다.
- Permanent guardrail:
  - `exam_registrations -> exam_locations` embed는 항상 `exam_locations!exam_registrations_location_round_fkey`처럼 FK를 명시한다.
  - PostgREST embed failure 가능성이 있는 admin list screen은 empty state와 error state를 분리한다. query가 실패하면 빈 목록 문구를 재사용하지 않는다.
- Related files:
  - `app/exam-manage.tsx`, `app/exam-manage2.tsx`, `docs/handbook/mobile/exam-flows.md`
- Verification:
  - `npm run lint -- app/exam-manage.tsx app/exam-manage2.tsx`
  - anon Supabase 재현 스크립트로 bare relation `PGRST201` 확인 후 explicit FK select에서 life/nonlife rows 반환 확인

## 2026-04-14 | Mobile Android Fabric | `/referral` crash를 개별 화면 이슈로만 닫고 같은 scroll-wrapper 패턴이 남은 화면들을 즉시 정리하지 않음
- Symptom:
  - `/referral`은 이미 plain `ScrollView`로 옮겨졌는데도, 현재 앱에는 `dashboard`, `exam-apply*`, `exam-register*`, `fc/new`처럼 `KeyboardAwareWrapper + RefreshControl + 큰 조건부 렌더` 조합이 그대로 남아 있었다.
  - Play Console에서 본 `ReactClippingViewManager.addView` / `The specified child already has a parent` 계열 Fabric crash를 특정 route 하나로만 보면, 현재 릴리스에서도 같은 crash family가 다른 화면에서 이어질 수 있다.
- Root cause:
  - Android production crash 원인을 `/referral` 로컬 구조와 연결해 복구한 뒤, 같은 wrapper ownership 패턴이 모바일 다른 고변동 화면에도 남아 있는지 screen-by-screen으로 즉시 재감사하지 않았다.
  - `app/AGENTS.md`도 `KeyboardAwareWrapper` 재사용을 일반 권장으로만 적어 두고, Android Fabric 예외 규칙을 명시하지 않았다.
- Why it was missed:
  - incident를 "추천인 화면 회귀"로만 닫고 "Android Fabric scroll ownership" 공통 규칙으로 승격하지 않았다.
  - local source audit와 Play Console version split은 별개의 작업인데, 전자는 진행하면서도 후자를 기다리느라 남은 위험 화면 batch hardening이 늦어질 수 있는 상태였다.
- Permanent guardrail:
  - Android new architecture/Fabric에서 `RefreshControl`과 큰 조건부 렌더 tree를 가진 화면은 `KeyboardAwareWrapper`를 primary scroll owner로 쓰지 않는다.
  - 이런 screen은 Android에서 plain `ScrollView` + explicit keyboard padding으로 유지하고, iOS에서만 `KeyboardAwareWrapper`를 남긴다.
  - 한 화면에서 wrapper-related native crash를 복구하면 같은 pattern이 남아 있는 route들을 같은 change set 또는 즉시 후속 batch로 나열해 확인한다.
- Related files:
  - `app/referral.tsx`, `app/dashboard.tsx`, `app/exam-apply.tsx`, `app/exam-apply2.tsx`, `app/exam-register.tsx`, `app/exam-register2.tsx`, `app/fc/new.tsx`, `app/AGENTS.md`, `docs/referral-system/INCIDENTS.md`
- Verification:
  - `npm run lint -- app/dashboard.tsx app/exam-apply.tsx app/exam-apply2.tsx app/exam-register.tsx app/exam-register2.tsx app/fc/new.tsx`
  - `node scripts/ci/check-governance.mjs`
  - follow-up Android release build QA + Play Console cluster trend 확인

## 2026-04-14 | Mobile Referral Tree | preload depth와 subtree lazy-expand depth 계약을 한 tree로 보지 않아 deeper branch가 느리고 스타일도 어긋남
- Symptom:
  - `/referral`에서 `하기홍` 아래는 바로 열리는데 `박충희`처럼 depth 2 밖의 node 아래는 늦게 열리고, lazy-load로 붙은 child row가 다시 top-level 주황 스타일처럼 보였다.
- Root cause:
  - 첫 화면은 `depth:2` preload, deeper node는 subtree lazy fetch인데 `hooks/use-referral-tree.ts`가 subtree-relative `node_depth`를 현재 화면 root 기준 absolute depth로 정규화하지 않은 채 merge했다.
  - `components/ReferralTreeNode.tsx`는 들여쓰기는 render depth로 계산하면서 강조 스타일은 raw `node.depth === 1`에 묶어, preload node와 lazy node가 서로 다른 시각 규칙을 탔다.
  - 또한 tree success/no-ancestor 상태에서도 `app/referral.tsx`가 `get-my-referral-code` cache를 direct recommender fallback으로 재사용해 stale 상단 정보를 보여줄 수 있었다.
- Why it was missed:
  - `get-referral-tree` / `get_referral_subtree` transport depth가 subtree root 기준 상대값이라는 점은 알고 있었지만, 실제 모바일 UI가 preload branch와 lazy branch를 같은 tree surface에서 어떻게 합치는지까지 검증하지 않았다.
  - “하기홍은 빠름 / 박충희는 느림”처럼 depth-dependent한 체감 차이를 데이터량 차이로 보기 쉽고, render depth와 payload depth가 분리돼 있다는 점을 뒤늦게 확인했다.
- Permanent guardrail:
  - tree API가 subtree root 기준 depth를 반환하면, 화면 cache merge 전에 현재 화면 root 기준 absolute depth로 다시 쓴다. recursive tree UI에서는 들여쓰기와 강조 스타일 모두 같은 render-depth 규칙을 사용하고 transport depth를 style source로 재사용하지 않는다.
  - `depth:N preload + lazy expand`가 섞인 tree는 representative 계정 1개로 `preloaded branch`와 `deeper lazy branch`를 둘 다 열어 본다. 두 branch의 속도/스타일이 다르면 같은 session에서 root cause를 정리한 뒤 문서와 테스트 케이스에 남긴다.
- Related files:
  - `app/referral.tsx`
  - `components/ReferralTreeNode.tsx`
  - `hooks/use-referral-tree.ts`
  - `lib/referral-tree.ts`
  - `docs/referral-system/SPEC.md`
  - `docs/referral-system/ARCHITECTURE.md`
  - `docs/referral-system/INCIDENTS.md`
- Verification:
  - `npm run lint -- app/referral.tsx components/ReferralTreeNode.tsx hooks/use-referral-tree.ts lib/referral-tree.ts lib/__tests__/referral-tree.test.ts`
  - `npm test -- --runInBand lib/__tests__/referral-tree.test.ts`

## 2026-04-13 | Mobile Exam Applicants | 웹에서 고친 resident/phone 매칭 hardening을 모바일 `exam-manage*`에 옮기지 않아 본부장 목록이 통째로 비어 보임
- Symptom:
  - 가람in 본부장(read-only manager) 세션에서 `생명/제3 신청자 관리`, `손해 신청자 관리` 화면에 실제 신청 row가 있어도 목록이 전혀 보이지 않았다.
- Root cause:
  - 모바일 `app/exam-manage.tsx`, `app/exam-manage2.tsx`가 `exam_registrations.resident_id -> fc_profiles.phone` exact match만 사용했고, profile을 못 찾으면 row를 `continue`로 버렸다.
  - 동시에 주민번호 full-view 보조 read를 위해 `appSessionToken`을 query enable 조건에 넣어, 토큰이 없을 때는 목록 read 자체가 시작되지 않았다.
- Why it was missed:
  - 2026-04-06에 웹 `/dashboard/exam/applicants`에서 raw/digits/hyphenated phone 후보 매칭과 resident-number fallback contract를 정리했지만, 같은 도메인의 모바일 `exam-manage*` 복제 구현과 parity를 다시 대조하지 않았다.
- Permanent guardrail:
  - 시험 신청자 surface는 웹과 모바일을 따로 보지 말고 한 계약으로 점검한다. `resident_id -> profile lookup`, `profile miss fallback`, `resident-number trusted read failure`, `manager read-only session` 네 축을 `web/src/app/dashboard/exam/applicants/page.tsx`와 `app/exam-manage*.tsx`에서 함께 비교한다.
  - 주민번호 full-view는 부가 read일 뿐이므로, trusted read 토큰 부재나 decrypt 실패가 신청자 목록 전체를 숨기는 enable 조건이 되어서는 안 된다.
- Related files:
  - `app/exam-manage.tsx`
  - `app/exam-manage2.tsx`
  - `docs/handbook/mobile/exam-flows.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `npm run lint -- app/exam-manage.tsx app/exam-manage2.tsx`

## 2026-04-10 | Android Referral Render Stability | keyboard-aware scroll을 multi-state self-service 화면의 기본 컨테이너로 유지한 채 Android render stability 검증을 건너뜀
- Symptom:
  - Android production `3.1.3`에서 `/referral` 화면 관련으로 `ReactClippingViewManager.addView`, `dispatchGetDisplayList`, `null child at index` 계열 crash가 발생했다.
- Root cause:
  - `KeyboardAwareWrapper(react-native-keyboard-aware-scroll-view)` 위에 `RefreshControl`, edit mode, tree/error/success 상태 전환 같은 child churn이 큰 화면을 올려두고도 Android production stability를 별도 체크하지 않았다.
- Why it was missed:
  - keyboard overlap UX를 우선시하면서 third-party keyboard-aware scroll의 Android native hierarchy cost를 과소평가했고, 기능 점검은 했어도 Android vitals 류 render stability는 별도 acceptance criterion으로 두지 않았다.
- Permanent guardrail:
  - Android primary screen이 `RefreshControl + large conditional sections + expand/collapse tree`를 함께 가지면 keyboard-aware wrapper를 기본값으로 쓰지 않는다. 먼저 plain `ScrollView`/stable container로 시작하고, keyboard auto-scroll이 꼭 필요할 때만 안전하게 추가한다. 릴리스 전에는 해당 화면의 Android 진입/편집/새로고침 전환을 production-like build에서 확인한다.
- Related files:
  - `app/referral.tsx`
  - `components/KeyboardAwareWrapper.tsx`
  - `docs/referral-system/TEST_CHECKLIST.md`
  - `.claude/MISTAKES.md`
- Verification:
  - `npx eslint app/referral.tsx`

## 2026-04-10 | Referral Inline Self-Service | secondary tree query를 기본 self-service 화면에 합치면서 mutation sync와 degraded fallback을 함께 남기지 않음
- Symptom:
  - 추천인 저장 성공 직후 `/referral`의 `나를 추천한 경로`가 이전 상태로 남았고, `get-referral-tree`가 실패하면 기존 추천인 사용자는 `변경하기` CTA 자체를 잃었다.
- Root cause:
  - `app/referral.tsx`가 추천인 저장 후 `get-my-referral-code`만 refetch했고, 기존 `변경하기` affordance를 tree success 렌더 안으로만 옮겼다.
- Why it was missed:
  - inline tree 흡수 작업에서 중복 UI 제거와 정상 흐름에만 집중했고, tree를 “부가 read”가 아니라 실제 primary self-service affordance 일부로 취급해 degraded mode parity를 따로 점검하지 않았다.
- Permanent guardrail:
  - secondary query가 기본 self-service 화면을 enrich하더라도 mutation affordance는 primary trusted read만으로도 계속 열려야 한다. 같은 화면에서 여러 query가 같은 도메인 값을 표현하면, mutation 성공 알림 전에 관련 query를 모두 refetch/invalidate한다.
- Related files:
  - `app/referral.tsx`
  - `hooks/use-my-referral-code.ts`
  - `hooks/use-referral-tree.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - `npx eslint app/referral.tsx`

## 2026-04-10 | Referral Tree Rollout | 앱 화면만 먼저 테스트하고 trusted backend rollout 상태를 같이 확인하지 않아 즉시 `불러오기 실패`가 발생함
- Symptom:
  - 모바일 `추천 관계 전체 보기` 화면이 열리지만, 첫 진입에서 곧바로 `불러오기 실패` 에러 상태로 떨어졌다.
- Root cause:
  - 새 모바일 route와 hook는 로컬에 반영됐지만, 원격 Supabase에는 `get-referral-tree` Edge Function이 아직 배포되지 않았고 `get_referral_subtree` migration도 적용되지 않았다.
- Why it was missed:
  - 정적 검증과 거버넌스 통과를 마감 기준처럼 다루고, self-service 화면이 의존하는 `Edge Function 존재 여부 + 원격 DB 계약`을 같은 턴의 런타임 체크로 확인하지 않았다.
- Permanent guardrail:
  - 새 trusted path를 앱에서 바로 호출하는 기능은 `화면 구현 완료`로 닫지 않는다. 최소한 `functions list/deploy`, 필요한 migration 적용 여부, 대표 계정 1개 실호출까지 확인한 뒤에만 사용자 테스트를 시작한다. migration이 당장 막히면 화면 호출부를 막기보다 Edge Function fallback 또는 rollout 순서를 먼저 정리한다.
- Related files:
  - `supabase/functions/get-referral-tree/index.ts`
  - `supabase/migrations/20260410000001_add_referral_subtree_rpc.sql`
  - `app/referral-tree.tsx`
  - `.claude/MISTAKES.md`
- Verification:
  - `supabase functions list --project-ref ubeginyxaotcamuqpmud`
  - `supabase functions deploy get-referral-tree --project-ref ubeginyxaotcamuqpmud`
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/get-referral-tree/index.ts`

## 2026-04-10 | Referral Tree Ancestor Contract | manager shadow를 descendant 오염 방지 규칙으로만 보지 않고 ancestor chain까지 같이 제외해 실제 추천인이 화면에서 사라짐
- Symptom:
  - `01051078127` 계정은 `fc_profiles.recommender='서선미'`, `recommender_fc_id=<서선미 shadow fc_id>`로 저장돼 있는데, `나를 추천한 경로`에는 서선미가 나타나지 않았다.
- Root cause:
  - `get_referral_subtree` SQL과 `get-referral-tree` fallback이 모두 `is_manager_referral_shadow=true` row를 ancestor traversal에서도 제외하고 있었다.
- Why it was missed:
  - manager shadow를 “트리를 오염시키는 synthetic row”로만 생각했고, 실제 운영 데이터에서는 manager 추천인이 구조화 링크로 shadow row에 저장된다는 점을 ancestor UX 요구와 함께 검토하지 않았다.
- Permanent guardrail:
  - `is_manager_referral_shadow`는 descendant child traversal에서만 기본 제외 규칙으로 다루고, `recommender_fc_id`에 실제로 저장된 ancestor recommender는 보여준다. “shadow 제외” 규칙을 문서화할 때는 ancestor/descendant에 동일 적용한다고 쓰지 말고, 경로별 예외를 같이 적는다.
- Related files:
  - `supabase/functions/get-referral-tree/index.ts`
  - `supabase/migrations/20260410000001_add_referral_subtree_rpc.sql`
  - `supabase/schema.sql`
  - `docs/referral-system/SPEC.md`
  - `docs/referral-system/ARCHITECTURE.md`
  - `contracts/database-schema.md`
- Verification:
  - service-role query: `01051078127.recommender_fc_id -> 18f79264-5b93-4f37-a171-a459ab6c578a (서선미, manager shadow)`
  - `supabase functions deploy get-referral-tree --project-ref ubeginyxaotcamuqpmud`
  - `npx eslint --rule "import/no-unresolved: off" supabase/functions/get-referral-tree/index.ts`

## 2026-04-10 | Referral Self-Service / Tree Auth | drill-down 화면 요청 패턴과 Edge Function 인가 범위를 따로 잡아 lazy expand가 막힐 뻔함
- Symptom:
  - 모바일 `추천 관계 전체 보기`는 descendant node를 탭할 때마다 해당 노드를 root로 한 subtree를 다시 읽는 구조인데, 초기 구현 계약을 `fcId=self only`로 잡으면 첫 화면은 떠도 2단계 expand부터 403으로 막히게 된다.
- Root cause:
  - 화면 설계(ancestor chain + subtree lazy drill-down)와 서버 인가 규칙을 같은 계약으로 검토하지 않았고, `초기 로드 root 기준 조회`와 `후속 descendant root 재조회`를 서로 다른 문제처럼 취급했다.
- Why it was missed:
  - self-service 보안 경계를 좁게 잡는 데만 집중해, 실제 화면이 어떤 `fcId`들을 후속 요청으로 보낼지까지 함께 대조하지 않았다.
- Permanent guardrail:
  - self-service 화면이 lazy expand / cursor / detail drill-down으로 하위 노드 id를 다시 요청하면, Edge Function 인가도 `self only`가 아니라 `self subtree membership` 기준으로 설계한다. 화면 요청 패턴(`router/queryFn/loadChildrenOf`)과 서버 인가(`requested id` 허용 범위)를 같은 리뷰 체크리스트에서 한 번에 대조한다.
- Related files:
  - `app/referral-tree.tsx`
  - `hooks/use-referral-tree.ts`
  - `supabase/functions/get-referral-tree/index.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - `npx eslint app/referral-tree.tsx hooks/use-referral-tree.ts`
  - `npx eslint supabase/functions/get-referral-tree/index.ts`

## 2026-04-07 | Governance / Path Owner Map | 새 handbook-sensitive Edge Function helper를 추가하고도 owner-map 규칙 편입을 빼먹음
- Symptom: `fc-onboarding-app` push run은 성공했지만 최신 PR governance run에서 `supabase/functions/_shared/password-reset-account.ts`, `supabase/functions/_shared/request-board-password-sync.ts`에 대한 `No path-owner-map rule` 오류가 발생했다.
- Root cause: `supabase/functions/` 아래 새 helper를 추가하면서 handbook-sensitive path-owner-map가 `_shared` 경로까지 이미 커버한다고 착각했고, 실제 prefix rule에 파일 2개를 넣지 않았다.
- Why it was missed: local build와 push run만 먼저 보고 PR `pull_request` 기준 거버넌스에서 `main -> branch head` 전체 diff를 다시 대조하지 않았다.
- Permanent guardrail: `supabase/functions/` 아래 새 폴더나 `_shared/*.ts` helper를 추가할 때는 구현 직후 `docs/handbook/path-owner-map.json`의 관련 rule(`backend-auth-bridge`, `backend-admin-ops`, `backend-runtime` 등)에 prefix가 실제로 있는지 먼저 확인한다. push success만으로 닫지 말고 PR run에서 `No path-owner-map rule`이 없는지까지 본다.
- Related files:
  - `docs/handbook/path-owner-map.json`
  - `supabase/functions/_shared/password-reset-account.ts`
  - `supabase/functions/_shared/request-board-password-sync.ts`
  - `.claude/MISTAKES.md`
- Verification:
  - `gh run view 24061299763 --repo jj8127/Appointment-Process --log-failed`
  - `cd E:\hanhwa\fc-onboarding-app && node scripts/ci/check-governance.mjs`

## 2026-04-07 | request_board Password Mirror Contract | plain admin까지 request_board sync caller가 계속 남아 contract drift를 만들고 있었음
- Symptom: request_board 쪽 direct mirror 대상이 `fc | designer`(+ `manager -> fc`, `developer -> fc`)로 좁아졌는데도, `login-with-password`, `set-admin-password`, password reset builder 일부는 plain `admin`까지 request_board sync를 계속 시도하고 있었다.
- Root cause: request_board sync transport와 target-role 결정 로직이 `login-with-password`, `set-password`, `reset-password`, `set-admin-password`, `_shared/password-reset-account`에 복제돼 있었고, contract 변경을 한 surface에만 반영했다.
- Why it was missed: request_board에서 `admin_not_mirrored` skip을 허용하고 있었기 때문에 즉시 사용자-visible 장애로 보이지 않았고, 그래서 "실제로는 필요 없는 privileged sync 시도"를 drift로 분류하지 않았다.
- Permanent guardrail: request_board mirror target 결정은 shared helper + `_shared/password-reset-account` builder에서만 관리한다. plain `admin`은 `null`, `developer`는 `fc`, `manager`는 `manager`, linked `designer`는 `designer`라는 매핑을 로그인/최초설정/reset/admin설정 4개 caller에서 함께 대조한다.
- Related files:
  - `supabase/functions/_shared/request-board-password-sync.ts`
  - `supabase/functions/_shared/password-reset-account.ts`
  - `supabase/functions/login-with-password/index.ts`
  - `supabase/functions/reset-password/index.ts`
  - `supabase/functions/set-password/index.ts`
  - `supabase/functions/set-admin-password/index.ts`
- Verification:
  - `cd E:\hanhwa\fc-onboarding-app\web && npm run build`
  - `cd E:\hanhwa\fc-onboarding-app && node scripts/ci/check-governance.mjs`
  - `deno --version` (runtime static check tool availability 확인)

## 2026-04-07 | Local Generated State / Ignore Policy | Supabase CLI 생성물과 로컬 Codex 권한 파일을 tracked 상태로 유지함
- Symptom: 저장소에 `supabase/.temp/*`와 `.claude/settings.local.json`이 tracked 상태로 남아 있어, 현재 개발자 로컬 Supabase link 상태와 도구 권한 설정이 repo diff로 전파될 수 있었다.
- Root cause: `.gitignore`에 `supabase/.temp/`와 `.claude/settings.local.json`가 빠져 있었고, generated/local-only state를 source artifact와 같은 수준으로 다루는 관성이 남아 있었다.
- Why it was missed: 파일들이 직접 runtime code를 바꾸지 않으니 위험도가 낮다고 착각했고, build/governance가 통과하는 동안에도 "machine-local/generated state가 git에 있으면 안 된다"는 기준을 별도 확인하지 않았다.
- Permanent guardrail: Supabase CLI나 Codex가 새 파일을 만들면 먼저 `generated/local-only` 여부를 판단한다. `supabase/.temp/**`와 `.claude/settings.local.json`은 항상 untracked가 원칙이며, cleanup 배치에서는 `git ls-files`와 `git check-ignore -v`로 실제 상태를 증명한 뒤에만 문서화한다.
- Related files:
  - `.gitignore`
  - `.claude/settings.local.json`
  - `supabase/.temp/cli-latest`
  - `supabase/.temp/project-ref`
- Verification:
  - `git -C E:\hanhwa\fc-onboarding-app ls-files .claude/settings.local.json supabase/.temp`
  - `git -C E:\hanhwa\fc-onboarding-app check-ignore -v --no-index .claude/settings.local.json supabase/.temp/cli-latest`
  - `node scripts/ci/check-governance.mjs`
  - `cd E:\hanhwa\fc-onboarding-app\web && npm run build`

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

## 2026-04-06 | Dashboard KPI / Workflow Summary | 상단 카드 집계를 raw status shortcut으로 두어 화면 라벨과 실제 의미가 어긋남
- Symptom: 대시보드 상단 카드가 `총 인원`을 사실상 가입 완료 FC 전체 수로 보여주면서 `활성 FC 현황`이라 표기했고, `보증 보험 동의 대기`와 `서류검토 대기`도 workflow helper가 아닌 raw `status` shortcut 기준이라 운영자가 보는 의미와 숫자가 완전히 일치하지 않았다.
- Root cause: 목록/모달/배지에서는 `calcStep`, `getAllowanceDisplayState`, `getDocProgress` 같은 파생 workflow helper를 쓰는데, 상단 KPI 카드만 `fcs.length`, `allowance-pending`, `docs-pending|docs-submitted` 같은 단순 status 집계로 남겨 두었다.
- Why it was missed: 카드 숫자가 대략 그럴듯하게 움직였고, 세부 모달/배지 로직을 먼저 고치면서 summary card는 "단순 카운터"로 취급했다.
- Permanent guardrail: 대시보드 KPI는 raw status shortcut을 직접 세지 않는다. 카드 문구와 숫자가 workflow 단계 의미를 공유해야 할 때는 list badge와 같은 helper(`calcStep`, `getAllowanceDisplayState`, `getDocProgress`)를 재사용하고, 문구가 helper 의미와 다르면 copy도 같이 수정한다.
- Related files: `web/src/app/dashboard/page.tsx`, `docs/handbook/admin-web/dashboard-lifecycle.md`, `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `Get-Content web/src/app/dashboard/page.tsx`, `Get-Content web/src/lib/fc-workflow.ts`, `Get-Content web/src/lib/shared.ts`

## 2026-04-06 | Documentation Governance / Commit Batch | 누적 코드 변경을 한 번에 커밋하려다 WORK_LOG/WORK_DETAIL 갱신 없이 먼저 검증해 governance에 걸림
- Symptom: 누적된 auth/session/web 진입 변경을 한 번에 커밋하려고 `node scripts/ci/check-governance.mjs`를 돌렸더니 `Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.`로 실패했다.
- Root cause: 기존 워킹트리에 남아 있던 코드 변경을 "이미 알고 있는 작업"으로 보고, 이번 커밋 배치에서 필요한 로그 갱신을 생략한 채 검증부터 돌렸다.
- Why it was missed: 장수 브랜치에서 누적 변경을 정리할 때 파일 diff는 확인했지만, 거버넌스가 요구하는 "현재 커밋 배치 기준 로그 동반" 규칙을 다시 적용하지 않았다.
- Permanent guardrail: 누적 변경을 뒤늦게 커밋할 때도 `git diff --stat` 단계에서 코드 파일이 보이면, 스테이징 전에 `WORK_LOG.md`/`WORK_DETAIL.md` 동반 갱신 여부를 먼저 확인한다. "예전에 문서화했을 것"이라는 기억으로 넘어가지 않는다.
- Related files: `.claude/MISTAKES.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Verification: `git diff --stat`, `node scripts/ci/check-governance.mjs`

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

## 2026-04-06 | Admin Web Workflow Tabs | 보증 보험 동의에만 있던 direct-input 계약을 생명/손해 위촉 완료일에는 맞추지 않아 운영 입력 흐름이 탭마다 갈라짐
- Symptom: 총무는 `보증 보험 동의` 탭에서는 `동의일(Actual)`을 trusted path로 직접 저장할 수 있었지만, `생명/손해 위촉` 탭에서는 같은 종류의 실제 완료일을 `승인 완료` 흐름에 기대어 우회적으로만 처리해야 했다.
- Root cause: dashboard workflow tab을 단계별로 따로 보강하면서 `실제 날짜 직접입력 + trusted save route + status normalization + list invalidation` 계약을 allowance에만 만들고 appointment에는 parity 체크를 하지 않았다.
- Why it was missed: 기존 appointment tab에 `승인 완료` 버튼이 이미 있다는 이유로 "총무도 입력 가능하다"라고 간주했고, 보증 보험 동의에서 분리한 direct-input 패턴을 다른 workflow tab에도 적용해야 하는지까지 대조하지 않았다.
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

## 2026-04-23 | Referral Graph Single-State | 그래프 런타임 모델을 단일 edge로 바꿔 놓고도 subtitle/범례 copy는 예전 다중 상태 설명을 남겨둠
- Symptom: 추천인 single-state 구현 뒤에도 `/dashboard/referrals/graph` 상단 설명과 범례에 `추천인 연결 + 확인`, `추가 확인` 같은 old edge-state 문구가 그대로 보여 사용자가 여전히 두세 종류의 live 관계가 있다고 해석할 수 있었다.
- Root cause: 타입/API/렌더링 로직만 단일화하고, 화면 설명·범례·empty/help copy까지 같은 계약 변경에 포함해야 한다는 확인이 빠졌다.
- Why it was missed: "edge 색/데이터 shape가 단순해졌으니 끝났다"는 식으로 내부 계약 수정에만 집중했고, 사용자-facing explanation audit를 같은 change set의 acceptance check로 두지 않았다.
- Permanent guardrail: 상태 모델을 단순화하거나 이름을 바꿀 때는 `types + API + renderer + subtitle/legend/badge/help text`를 한 묶음으로 grep해서 old vocabulary가 남았는지 확인한다. 특히 graph/list/operator surface는 data contract 정리 후 반드시 문구까지 함께 맞춘다.
- Related files: `web/src/types/referral-graph.ts`, `web/src/lib/referral-graph-edges.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/app/dashboard/referrals/graph/page.tsx`
- Verification: `cd E:\hanhwa\fc-onboarding-app\web && npm run lint -- src/app/dashboard/referrals/graph/page.tsx`, `/dashboard/referrals/graph` 브라우저 smoke

## 2026-04-24 | Referral Graph Visual QA | 비어 있지 않은 canvas smoke만으로 Obsidian형 사용성/물리 품질을 완료처럼 판단함
- Symptom: radial layout과 drag inertia를 구현한 뒤 canvas nonblank, 버튼 클릭, 기본 drag smoke는 통과했지만 사용자가 실제 화면에서 Obsidian Graph View처럼 보기 편하지 않고 물리 품질이 낮다고 느꼈다. 이어서 이름 라벨을 없애면 안 된다는 조건, 그룹끼리 겹치면 안 된다는 조건, drag 중 링크가 길게 늘어나면 안 된다는 조건, drag 후 노드가 놓은 위치에 즉시 머물러야 한다는 조건이 추가로 확인됐다.
- Root cause: 구현 검증이 `렌더됨/상호작용됨`에 치우쳤고, 요구의 핵심인 visual density, label readability, node/link weight, component envelope overlap, drag release after-feel을 별도 acceptance로 분리하지 않았다.
- Why it was missed: Obsidian 참고를 force 설정명과 radial seed에만 반영했고, 공식 Graph View의 display/forces 항목처럼 text fade, node size, link thickness, center/repel/link/distance가 함께 만드는 읽기 경험을 screenshot 기준으로 충분히 평가하지 않았다. 또한 실제 운영 데이터의 connected component끼리 겹치지 않는지 component radius 기준으로 계산하지 않고, drag smoke도 "움직인다"만 보고 "링크가 찢어지지 않는가"와 "사용자가 놓은 좌표에서 release velocity가 즉시 0이 되는가"를 확인하지 않았다.
- Permanent guardrail: graph/visualization 작업은 unit test와 nonblank smoke만으로 완료 처리하지 않는다. 최소 한 장의 실제 viewport screenshot을 확인하고, `이름 라벨 가시성`, `일반 label code 과노출 여부`, `node radius`, `link alpha/thickness`, `connected component overlap 없음`, `drag 중 linked neighbor follow`, `drag 후 hard pin 없음`, `drag 후 dropped position 즉시 유지`를 acceptance로 적어야 한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-display.ts`, `web/src/lib/referral-graph-highlight.ts`, `.codex/harness/qa-report.md`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-layout.test.ts`, `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts`, `node --experimental-strip-types --test web/src/lib/referral-graph-display.test.ts`, `node --experimental-strip-types --test web/src/lib/referral-graph-highlight.test.ts`, synthetic Playwright screenshot `.codex/harness/referral-graph-obsidian-overview-qa.png`, real-data screenshot `.codex/harness/referral-graph-no-overlap-qa.png`

## 2026-04-24 | Referral Graph Drag Physics | 수동 위치 force가 d3 velocity를 덮어써 release 후 기존 물리가 죽고 링크 길이가 비정상적으로 남음
- Symptom: 사용자가 노드를 드래그한 뒤 직접 연결선이 비정상적으로 길게 남는다고 보고했다. 추가로 "드래그한 위치에서 크게 벗어나면 안 되지만, 기존 물리법칙은 놓았을 때도 유지되어야 한다"는 계약이 확인됐다.
- Root cause: `manual-placement` force가 link/charge/center force가 만든 `vx/vy`에 더하는 대신 마지막에 값을 교체했다. 이 때문에 soft anchor가 사실상 기존 graph physics를 무력화했고, follower anchor도 모든 이동 follower에 갱신되지 않아 일부 이웃이 이전 layout target으로 돌아가며 edge stretch가 남을 수 있었다.
- Why it was missed: "놓은 위치 유지"를 "속도 제거/강한 anchor"로만 해석했고, d3 force tick에서는 여러 force가 velocity를 누적해야 한다는 계약을 테스트로 고정하지 않았다. direct neighbor가 drag delta 전체를 따라오는지, follower anchor가 새 위치로 저장되는지도 별도 회귀 테스트가 없었다.
- Permanent guardrail: force-graph drag UX를 수정할 때 manual/user placement force는 기존 `vx/vy`를 overwrite하지 않고 additive correction으로만 구현한다. 2026-04-25 후속 조사로 follower 좌표 직접 이동과 follower anchor 저장도 금지됐다. 테스트에는 direct link stretch 방지, correction cap/additive semantics, no-follower-coordinate-move를 포함한다.
- Related files: `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-interaction.test.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts`, targeted web lint, `cd web && npm run build`

## 2026-04-25 | Referral Graph Drag Ownership | follower 좌표 직접 이동과 anchor 누적으로 d3 force 자유도를 잃음
- Symptom: 사용자가 노드를 드래그하면 edge가 비정상적으로 길어지고, release 후 노드가 1초가량 멋대로 움직이거나 edge가 겹친 상태로 멈췄다. drag 중에도 시간이 지나면 link가 원래 길이로 돌아가야 한다는 Obsidian형 rubber-band 계약이 확인됐다.
- Root cause: drag 이벤트에서 1/2/3-hop follower의 `x/y`를 직접 이동하고 follower마다 persistent manual anchor를 남겼다. d3-force는 force가 velocity에 누적되어야 하는데, 좌표 직접 이동과 soft anchor 누적으로 link force가 이웃을 자연스럽게 복원할 자유도를 잃었다.
- Why it was missed: "관성"을 release 후 흔들림으로 이해했고, "edge가 길어지지 않게"를 follower 좌표를 함께 옮기는 방식으로 풀었다. 실제 요구는 drag 중에도 link spring이 계속 당기고, release 후에는 dropped position을 짧게 약하게만 기억하는 구조였다.
- Permanent guardrail: force-graph drag에서 pointer 대상 노드 외에는 좌표를 직접 쓰지 않는다. drag 중에는 대상 노드만 임시 `fx/fy`로 잡고 simulation을 reheat한다. release는 `fx/fy` 해제, recent sample 기반 clamped velocity 주입, dragged node 1개짜리 decaying drop tether만 허용한다. component/hub/drop 보정 force는 모두 `vx/vy += delta` 방식이어야 한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-interaction.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-layout.ts`
- Verification: `node --experimental-strip-types --test web/src/lib/referral-graph-interaction.test.ts web/src/lib/referral-graph-physics.test.ts web/src/lib/referral-graph-layout.test.ts web/src/lib/referral-graph-edges.test.ts`, targeted web lint, `cd web && npm run build`, Playwright synthetic browser QA screenshot `.codex/harness/referral-graph-physics-browser-qa.png`, `node scripts/ci/check-governance.mjs`

## 2026-06-04 | Mobile Theme | 시스템 다크 테마를 허용해 로그인/CTA 배경이 검정으로 보임
- Symptom: SM_S942N 실기기에서 로그인 화면과 일부 홈 CTA/card 영역이 의도한 흰색/주황색 톤 대신 검정 배경처럼 보였다.
- Root cause: `app.json`이 `userInterfaceStyle: automatic`이고 root navigation이 `DarkTheme`를 시스템 색상에 따라 적용했다. 로그인 화면도 native gradient가 늦게 붙거나 실패할 때 fallback `backgroundColor`가 없어 Android dark base가 그대로 드러날 수 있었다.
- Why it was missed: 색상 회귀를 개별 버튼/카드 스타일 문제로만 보고, Expo system UI + React Navigation theme + screen fallback background를 같은 acceptance로 묶지 않았다. 실기기 dark-mode screenshot 확인을 완료 조건에 두지 않아 같은 증상이 반복됐다.
- Permanent guardrail: 가람in 모바일은 별도 dark theme 구현 전까지 light-only 계약이다. `app.json`, root `ThemeProvider`, `NavigationBar`, screen/container fallback background를 함께 고정하고, UI 색상 회귀 수정 뒤에는 SM_S942N 또는 Android target에서 해당 화면 스크린샷을 반드시 확인한다.
- Related files: `app.json`, `app/_layout.tsx`, `app/login.tsx`
- Verification: `npm run lint -- app/_layout.tsx app/login.tsx`, `npx expo config --type public`, `npx expo run:android --device SM_S942N`, ADB screenshot `.codex/harness/evidence/kim-referral-auth/login-after-color-fix.png`

## 2026-06-04 | Admin Web FC Access | JS로 쓰는 웹 세션 쿠키를 그대로 FC 권한 근거로 쓰려 해 impersonation 위험을 만들 뻔함
- Symptom: 관리자 웹 추천인 그래프를 FC에게 열면서 `session_role=fc`, `session_resident=<전화번호>` 쿠키만 있으면 그래프 API allowlist를 통과할 수 있는 구조가 될 수 있었다.
- Root cause: 기존 admin web 세션이 client-side cookie/localStorage를 표시 상태와 서버 세션 힌트로 동시에 사용한다는 점을 충분히 분리하지 않았다. FC처럼 일반 사용자에게 웹 표면을 열 때는 "역할 쿠키 + DB에 전화번호 존재"가 인증 증명이 될 수 없는데, route containment와 graph downline scope만 먼저 구현했다.
- Why it was missed: staff-only 관리자 웹에서는 기존 쿠키 모델의 위험이 덜 드러났고, 새 FC 접근 요구를 "권한 스코프" 문제로만 봤다. 보안 subagent가 수동 쿠키 조작 공격 경로를 지적한 뒤에야 signed/HttpOnly 세션을 별도 추가했다.
- Permanent guardrail: admin web에 FC 또는 외부 사용자를 추가할 때는 JS-readable session cookie를 인증 근거로 쓰지 않는다. public login/API handoff에서 서버가 검증한 signed/HttpOnly cookie를 발급하고, protected API는 그 서명 세션을 다시 확인한다. UI 메뉴 제한은 server route/API authorization 이후의 보조 수단으로만 취급한다.
- Related files: `web/src/lib/fc-graph-session.ts`, `web/src/lib/server-session.ts`, `web/src/app/api/auth/login/route.ts`, `web/middleware.ts`, `web/src/lib/admin-referrals.ts`
- Verification: `node --test web/src/lib/admin-web-route-access.test.ts web/src/lib/referral-graph-scope.test.ts web/src/lib/fc-graph-session.test.ts`, targeted web lint, `cd web; SENTRY_AUTH_TOKEN='' npm run build`

## 2026-06-04 | Request Board Role Actions | 설계 완료 후 FC 승인/거절 액션을 설계매니저 화면에 노출
- Symptom: 설계매니저의 의뢰 상세 화면에서 설계 완료된 항목에 `거절`/`승인` 버튼이 표시됐다.
- Root cause: 완료된 assignment의 `fc_decision=pending` 상태를 FC 검토 조건과 설계매니저 관리 조건에 함께 재사용하면서, 액션 렌더링에 명시적인 역할 gate가 부족했다.
- Why it was missed: `request-board-review` 화면이 FC 검토와 설계매니저 상세/관리 surface를 공유하는데도, 완료 설계 이후의 액션 소유권을 역할별 테스트로 고정하지 않았다.
- Permanent guardrail: 완료 설계의 FC decision 버튼은 `!isRequestBoardDesigner && needsReview` 조건에서만 렌더링한다. 설계매니저 화면은 같은 상태를 `FC 검토 대기`로만 표시하고, 역할별 Android UI 확인 또는 그에 준하는 명시적 회귀 테스트를 남긴다.
- Related files: `app/request-board-review.tsx`, `lib/__tests__/request-board-review-role.contract.test.ts`
- Verification: `npx jest lib\__tests__\request-board-api-contract.test.ts lib\__tests__\request-board-mobile-products.test.ts lib\__tests__\request-board-review-role.contract.test.ts lib\__tests__\request-board-session.test.ts --runInBand`, `npx tsc --noEmit`, `npm run lint -- app\request-board-review.tsx lib\__tests__\request-board-review-role.contract.test.ts`, FC Android detail screenshot `.codex/harness/ui-qa/android-fc-review-detail-buttons-after-role-patch.png`; 설계매니저 Android visual pass는 사용자 지시로 보류하고 사용자 세션/임시 request_board 데이터는 복구 및 삭제했다.

## 2026-06-04 | Request Board Bottom Sheet | 완료 CTA를 Android 시스템 내비게이션 바와 겹치게 배치
- Symptom: 설계매니저 선택 바텀시트에 `1명 선택 완료` 버튼을 추가했지만 SM_S942N 화면에서 버튼 하단이 Android 시스템 내비게이션 바와 겹쳤다.
- Root cause: Modal 바텀시트 footer를 추가하면서 `useSafeAreaInsets().bottom`만 믿었고, Android edge-to-edge/에뮬레이터 환경에서 bottom inset이 `0`으로 들어오는 경우를 위한 충분한 fallback padding을 두지 않았다.
- Why it was missed: 버튼 존재/비활성 상태만 테스트하고, Android 하단 시스템 영역과의 충돌을 별도 계약으로 고정하지 않았다.
- Permanent guardrail: 모바일 바텀시트/고정 footer CTA를 추가할 때는 `safe-area bottom + 여유 여백`뿐 아니라 Android inset 0 fallback 최소 여백도 helper/test로 고정한다. 키보드가 열린 상태는 별도 분기로 과한 footer 여백을 주지 않는다.
- Related files: `app/request-board-create.tsx`, `lib/request-board-designer-selection.ts`, `lib/__tests__/request-board-designer-selection.test.ts`
- Verification: `npx jest lib\__tests__\request-board-designer-selection.test.ts --runInBand`, `npx tsc --noEmit`, `npm run lint -- app\request-board-create.tsx lib\request-board-designer-selection.ts lib\__tests__\request-board-designer-selection.test.ts`

## 2026-06-04 | Referral Invite Deep Link | 공유 링크와 회원가입 자동 적용 계약을 분리해서 추천 코드가 수동 입력처럼 남음
- Symptom: 추천인 코드 공유하기가 invite landing URL 대신 plain 추천 코드와 store link 중심으로 공유됐고, 앱 실행 후 회원가입으로 들어와도 추천 코드가 실제 선택/적용 상태가 되지 않을 수 있었다.
- Root cause: `EXPO_PUBLIC_INVITE_BASE_URL`이 없을 때 production invite page 기본값을 쓰지 않았고, pending deep-link code를 검색어로만 넣어 search result 선택 계약과 충돌시켰다.
- Why it was missed: 공유 문구 테스트와 회원가입 pending-code 상태 테스트가 분리되어 있지 않아, landing page URL 생성과 signup selected-referral 적용을 end-to-end 계약으로 고정하지 못했다.
- Permanent guardrail: invite/deep-link 기능은 `공유 URL -> landing query -> custom scheme -> pending storage -> signup selected state -> server validation -> persisted referralCode`를 한 흐름으로 테스트한다. 초대 링크 코드는 검색어가 아니라 선택된 추천인 placeholder로 먼저 적용하고 검증 결과로 보강한다.
- Related files: `app/referral.tsx`, `app/signup.tsx`, `lib/referral-share.ts`, `lib/signup-referral.ts`
- Verification: `npx jest lib\__tests__\referral-share.test.ts lib\__tests__\signup-referral.test.ts --runInBand`, focused Expo lint

## 2026-06-05 | Admin Web Next 16 Proxy | Vercel packaging에서 deprecated middleware output을 기대
- Symptom: Vercel `admin_web` preview가 build 막바지에 `ENOENT: no such file or directory, open '/vercel/path1/.next/server/middleware.js.nft.json'`로 실패했다.
- Root cause: `web`이 Next.js 16인데 route boundary 파일을 여전히 `middleware.ts` + `export function middleware`로 유지했다. Next 16 convention은 `proxy.ts` + `export function proxy`이고, Vercel packaging 단계가 middleware nft output을 찾으며 실패했다.
- Why it was missed: 로컬 `npm run build`만으로는 Vercel packaging 단계의 missing nft file을 재현하지 못했고, Next 16 migration convention을 preview 배포 검증 항목에 넣지 않았다.
- Permanent guardrail: Next.js 16 admin web에서 route gate/proxy boundary는 `web/proxy.ts`와 `export function proxy`를 사용한다. Vercel 배포 실패를 닫기 전에는 `vercel inspect <deployment> --logs`로 원격 packaging 오류를 확인하고, 가능하면 `npx vercel build`까지 로컬에서 실행한다.
- Related files: `web/proxy.ts`, `web/middleware.ts`
- Verification: `cd web; SENTRY_AUTH_TOKEN='' npm run build`, `cd web; npm run lint`, `node scripts/ci/check-governance.mjs`; remote failure evidence from `vercel inspect <deployment> --logs`.
- Local Vercel CLI note: `npx vercel build` inside `web` can double-apply `rootDirectory=web` and fail with local Windows `cmd.exe ENOENT`; do not treat that as the same failure as Vercel remote `middleware.js.nft.json`.

## 2026-06-04 | Exam Schedule Notifications | 시험 일정 알림을 `fc-notify` 대신 직접 Expo push로 보내려 함
- Symptom: 총무가 관리자 웹에서 시험 일정을 등록/수정해도 FC 모바일 알림이 안정적으로 도착하지 않는다고 보고됐다.
- Root cause: `web/src/app/dashboard/exam/schedule/actions.ts`가 shared notification contract인 `fc-notify`를 쓰지 않고 `notifications` direct insert, `device_tokens` direct query, Expo push direct send를 자체 구현했다.
- Why it was missed: 기존 게시판/알림 경로에서 이미 `notifications` row만 직접 쓰면 push fanout이 빠진다는 실수가 있었는데, 시험 일정 관리 server action을 같은 알림 계약 점검 대상으로 묶지 않았다.
- Permanent guardrail: 새 FC 대상 알림 소스는 `fc-notify` `type: notify` payload를 통해 inbox insert와 Expo fanout을 함께 처리한다. 직접 `notifications` insert 또는 direct Expo push block을 만들면 같은 변경 세트에서 helper/test로 예외 이유를 고정해야 한다.
- Related files: `web/src/app/dashboard/exam/schedule/actions.ts`, `web/src/lib/exam-round-notification.ts`, `web/src/lib/exam-round-notification.test.ts`, `supabase/functions/fc-notify/index.ts`
- Verification: `node --test src/lib/exam-round-notification.test.ts`, `cd web && npm run lint`

## 2026-06-04 | Admin Web FC Graph Session | FC용 관리자 웹 진입과 graph API 인증 계약을 다르게 둠
- Symptom: 관리자 웹 운영 error 비율이 관측됐고, FC graph page가 열려도 `/api/admin/referrals/graph`에서 `Invalid FC graph session` 401을 반복할 수 있는 경로가 확인됐다.
- Root cause: route gate/proxy는 JS-readable `session_role=fc`와 `session_resident`만 보고 graph page 진입을 허용했지만, graph API는 signed HttpOnly `fc_graph_session`까지 요구했다.
- Why it was missed: FC 관리자 웹 접근을 "페이지 제한"과 "API 스코프" 문제로 나누어 구현하면서, route gate와 API가 동일한 signed-session prerequisite을 요구하는지 확인하지 않았다.
- Permanent guardrail: 일반 FC에게 admin web surface를 열 때는 route gate, layout, API 모두 같은 signed/HttpOnly session prerequisite을 공유해야 한다. JS-readable role cookie는 화면 힌트로만 쓰고, stale cookie가 감지되면 관련 session cookies를 모두 지운다.
- Related files: `web/src/lib/admin-web-route-access.ts`, `web/src/lib/admin-web-proxy-handler.ts`, `web/src/lib/server-session.ts`, `web/src/app/api/admin/referrals/graph/route.ts`
- Verification: `node --test src/lib/admin-web-route-access.test.ts`, `cd web && npm run lint`

## 2026-06-04 | Referral Graph Real Data QA | 합성 그래프만 보고 김형수형 허브 fanout 회귀를 놓침
- Symptom: 추천인 그래프에서 김형수 밑 직속 노드들이 긴 원형 spoke처럼 일정하게 멀리 떨어지고, 실제 화면에서는 노드/라벨이 서로 붙어 보였다.
- Root cause: `referral-graph-layout`/`referral-graph-physics` 테스트가 synthetic pinwheel fixture 중심이라 실제 운영 데이터의 `김형수 -> 다수 직속 leaf` 구조를 그대로 검증하지 않았다. 또한 `dense fanout should lengthen spokes`류 assertion이 긴 원형 배치를 오히려 정당화했다.
- Why it was missed: 교차 수, 노드 최소거리, 최대 edge 길이를 실제 Supabase 그래프 payload로 계측하지 않았고, synthetic fixture의 상한/하한을 실제 화면 UX와 분리해서 유지했다.
- Permanent guardrail: 추천인 그래프 layout/physics 변경은 synthetic tests만으로 완료하지 않는다. `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`를 실제 Supabase 데이터로 실행해 `node count`, `edge count`, `edge crossing count`, `minimum node distance`, `max edge length`를 함께 확인한다. 긴 fanout 회귀를 막기 위해 leaf spoke 상한과 collision force를 production/test helper 양쪽에 같은 값으로 유지한다.
- Related files: `web/src/lib/referral-graph-realdata.test.ts`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`; `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`

## 2026-06-04 | Referral Graph Drag Session | static anchor maxTicks를 manual drag target에도 적용함
- Symptom: 실제 화면에서 초기 안정화가 끝난 뒤 같은 그래프 세션에서 노드를 다시 드래그하면, release 후 manual drop target 보정이 첫 드래그와 다르게 약해지거나 꺼질 수 있었다.
- Root cause: `createReferralGraphLayoutMemoryForce`가 `tickCount > maxTicks`이면 force 전체를 `return`했다. 이 값은 force 인스턴스 생애주기에 묶이므로 static anchor memory뿐 아니라 이후 드래그에서 새로 생기는 `manualNodeTargetsRef`까지 비활성화했다.
- Why it was missed: 테스트가 force 인스턴스를 새로 만들어 안정화 지표만 검증했고, 오래 열린 실제 UI 세션에서 `d3ReheatSimulation()`만 호출되는 드래그/릴리즈 경로를 별도로 고정하지 않았다.
- Permanent guardrail: static layout anchor aging과 manual drag/drop target은 같은 force 안에서도 별도 계약이다. `maxTicks`는 static anchor strength만 0으로 감쇠해야 하며, manual targets are live state and must continue after reheats. 해당 회귀는 `createReferralGraphLayoutMemoryForce keeps manual drag targets alive after static anchors age out`로 고정한다.
- Related files: `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --test src/lib/referral-graph-physics.test.ts`; `RUN_REFERRAL_GRAPH_REALDATA_TEST=1 node --test src/lib/referral-graph-realdata.test.ts`

## 2026-06-04 | Referral Search Contract | 추천인 검색을 이름이 아닌 소속/코드 fuzzy 검색까지 허용
- Symptom: 가람in 추천인 검색에서 `서선미`가 본인 검색 결과로 안정적으로 뜨지 않거나, `1본부 서선미`처럼 소속에 서선미가 들어간 산하 인원이 함께 노출됐다.
- Root cause: `search-fc-for-referral`과 `search-signup-referral`이 `fc_profiles.name`뿐 아니라 `affiliation`과 `referral_codes.code`까지 fuzzy 검색했다. 또한 활성 설계매니저가 추천인용 shadow profile/referral code를 아직 갖지 않은 경우 `manager_accounts` 기준으로 보강하는 경로가 없었다.
- Why it was missed: 초대 링크/추천코드 검증과 수동 추천인 검색을 같은 검색 UX로 묶었고, “본부장 이름은 이름 필드만 비교한다”는 계약 테스트가 없었다.
- Permanent guardrail: 수동 추천인 검색 입력창은 `name ilike`만 사용한다. 소속/하위 조직/추천코드 fuzzy 검색은 허용하지 않는다. 추천코드는 딥링크/저장 검증처럼 별도 명시 경로에서만 처리한다. 활성 설계매니저 이름이 검색되면 `manager_accounts`에서 shadow profile과 active referral code를 보강한다.
- Related files: `supabase/functions/search-fc-for-referral/index.ts`, `supabase/functions/search-signup-referral/index.ts`, `supabase/functions/_shared/referral-search.ts`, `components/ReferralSearchField.tsx`
- Verification: `npx jest supabase\functions\_shared\__tests__\referral-search.test.ts lib\__tests__\signup-referral.test.ts --runInBand`, `npx tsc --noEmit --pretty false`, `npx eslint components\ReferralSearchField.tsx app\referral.tsx app\signup.tsx`, deployed Edge Functions, live smoke `서선미` returned exactly one result with an active code.

## 2026-06-04 | Manager Exam Surface | 본부장 시험 홈을 신청 전용 화면으로 바꾸며 기존 관리 조회 링크를 제거
- Symptom: 본부장으로 가람in에 로그인해 시험 탭을 보면 기존 시험 목록/신청자 명단 조회 동선이 사라지고 생명/손해 시험 신청 링크만 남았다.
- Root cause: 모바일 본부장 세션은 `role='admin' + readOnly=true`로 정규화되는데, "본부장도 시험 신청 가능" 요구를 "본부장은 FC 신청 surface만 본다"로 잘못 해석했다. 홈 quick link도 기존 시험 관리 링크를 재사용하지 않고 FC 신청 링크만 사용했다.
- Why it was missed: 본부장은 read-only 관리 조회와 FC-equivalent 신청을 동시에 가져야 하는 복합 권한인데, 역할 테스트는 신청 허용 여부만 고정했고 기존 시험 목록/신청자 명단 유지 여부를 같이 확인하지 않았다.
- Permanent guardrail: 본부장 시험 홈은 `manager-management` surface로 분리한다. 기존 시험 목록/신청자 명단 조회 링크는 유지하고, `/exam-apply`, `/exam-apply2` 신청 링크를 추가한다. 시험 신청 route gate는 `role='fc'` 또는 `role='admin' && readOnly=true`를 허용한다.
- Related files: `app/index.tsx`, `app/exam-apply.tsx`, `app/exam-apply2.tsx`, `lib/exam-role.ts`, `lib/__tests__/exam-role.test.ts`
- Verification: `npx jest lib\__tests__\exam-role.test.ts --runInBand`, `npx eslint app\index.tsx lib\exam-role.ts lib\__tests__\exam-role.test.ts`, `npx tsc --noEmit --pretty false`, targeted `git diff --check`.

## 2026-06-05 | Referral Graph Layout Contract | 사용자 스케치와 반대되는 원형/콤팩트 테스트 기준을 유지
- Symptom: 사용자는 root 주변 원형 분배를 없애고, 자식 없는 짧은 엣지도 길이를 조금씩 다르게 하며, 자식 있는 허브는 더 긴 엣지를 갖는 스케치형 그래프를 요구했다. 하지만 기존 테스트는 terminal children full-circle fan, 짧은 child-hub bridge, 낮은 edge severity 기준을 계속 요구했다.
- Root cause: 추천인 그래프 테스트가 이전 "compact force graph" 계약을 제품 요구처럼 유지했고, 실제 사용자 sketch를 acceptance criteria로 재정의하지 않은 채 force 수치만 반복 조정했다. 또한 dead root-spoke link-style helper가 남아 있어 엣지 스타일 분기가 다시 살아날 위험이 있었다.
- Why it was missed: 합성 테스트 통과 여부를 우선 보면서 "왜 실패하는지"를 제품 계약 관점에서 다시 분류하지 않았다. 실제 Supabase graph test는 있었지만 테스트 threshold와 edge style 가중치가 바뀐 사실을 같이 업데이트하지 않았다.
- Permanent guardrail: 추천인 그래프 변경 시 먼저 현재 사용자 계약을 테스트 이름/threshold에 반영한다. 스케치형 branch/trunk 요구에서는 terminal-only hubs must be non-circular side fans, terminal leaves stay short but length-staggered, child hubs must use longer ID-varied branch bridges, and all links use one visible style. Real-data QA는 `RUN_REFERRAL_GRAPH_REALDATA_TEST=1`로 실행하고, force constant 상향이 실제 crossing을 악화시키면 즉시 되돌리고 deterministic layout mode를 별도 설계한다.
- Related files: `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-link-style.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`, graph tests under `web/src/lib/`.
- Verification: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; node --test src/lib/referral-graph-realdata.test.ts`.

## 2026-06-05 | FC Preregistration Gate | 사전등록 미완료 상태에서도 본등록 화면 진입을 허용
- Symptom: FC가 사전등록을 완료하지 않은 상태에서도 홈 빠른 메뉴 또는 직접 route로 `/fc/new` 본등록 화면에 진입할 수 있었다.
- Root cause: 로그인 Edge Function은 `signup_completed=false`를 거부했지만, 모바일 홈 quick link와 `/fc/new` 화면은 같은 `signup_completed` gate를 재사용하지 않았다.
- Why it was missed: 회원가입 완료 여부를 인증 계약에서만 확인하고, 홈 메뉴 노출/딥링크/저장 직전 방어를 별도 회귀 테스트로 고정하지 않았다.
- Permanent guardrail: 본등록/기본정보 편집 진입은 `canOpenFcProfileRegistration(profile)` 단일 helper로 판단한다. 홈 링크 노출, 버튼 핸들러, 직접 route 저장 전 검사가 모두 이 helper를 사용해야 한다.
- Related files: `app/index.tsx`, `app/fc/new.tsx`, `lib/fc-workflow.ts`, `lib/__tests__/workflow-step-regression.test.ts`
- Verification: `npm test -- --runTestsByPath lib/__tests__/workflow-step-regression.test.ts --runInBand`

## 2026-06-05 | Daum Postcode Debug UI | 주소 검색 WebView의 개발용 trace UI를 기본 화면에 노출
- Symptom: 본등록 주소 검색 중 `postcode debug mounted` 알림이 뜨고, `web:window.patch.ready...` trace banner가 주소 검색 UI 위에 겹쳐 보였다.
- Root cause: `components/DaumPostcode.tsx`가 `__DEV__`이면 mount alert와 debug banner를 기본 표시했다. Android 개발 빌드에서도 실제 사용자 검증 화면과 동일하게 보이기 때문에 디버그 UI가 업무 흐름을 막았다.
- Why it was missed: iOS WebView 이탈 추적용 instrumentation을 추가하면서 "로그는 남기되 화면은 opt-in"이라는 계약 테스트를 두지 않았다.
- Permanent guardrail: Daum postcode debug UI는 `EXPO_PUBLIC_POSTCODE_DEBUG_UI=1|true`일 때만 표시한다. 기본값에서는 로그만 남기고 Alert/banner를 렌더링하지 않는다.
- Related files: `components/DaumPostcode.tsx`, `lib/daum-postcode.ts`, `components/__tests__/DaumPostcode.contract.test.ts`
- Verification: `npm test -- --runTestsByPath components/__tests__/DaumPostcode.contract.test.ts --runInBand`

## 2026-06-05 | Hanwha PDF Delete Payload | 삭제 API에 불필요한 fileName을 필수로 요구
- Symptom: 관리자 대시보드에서 다위촉 URL PDF 삭제 버튼을 누르면 `fcId and fileName are required` 오류가 표시됐다.
- Root cause: `/api/admin/fc` route가 `createHanwhaPdfUploadUrl`과 `deleteHanwhaPdf`를 같은 분기에서 처리하면서, 실제 삭제에는 쓰지 않는 `fileName`까지 공통 필수값으로 검사했다.
- Why it was missed: 업로드 URL 생성 payload와 삭제 payload의 요구 필드를 하나의 조건으로 묶었고, 삭제는 DB에 저장된 `hanwha_commission_pdf_path`만 있으면 가능하다는 계약 테스트가 없었다.
- Permanent guardrail: 다위촉 PDF payload validation은 action별로 분리한다. 업로드 URL 생성은 `fcId + fileName`, 삭제는 `fcId`만 요구한다.
- Related files: `web/src/app/api/admin/fc/route.ts`, `web/src/app/dashboard/page.tsx`, `web/src/lib/admin-hanwha-pdf-payload.ts`, `web/src/lib/admin-hanwha-pdf-payload.test.ts`
- Verification: `node --test web/src/lib/admin-hanwha-pdf-payload.test.ts web/src/lib/admin-fc-doc-storage.test.ts`

## 2026-06-05 | Referral Graph Crossing Direction | 교차 edge를 anchor와 무관한 normal 방향으로 밀어 실제 데이터 교차를 남김
- Symptom: 실제 Supabase 추천인 그래프에서 초기 seed layout은 교차 0개였지만, 물리 시뮬레이션 후 `박윤미 -> 김희정`과 `박선희 -> 김은진` 같은 straight edge crossing이 계속 1개 이상 남았다.
- Root cause: `createReferralGraphEdgeCrossingForce`가 교차한 edge를 midpoint/deterministic normal 기준으로만 밀었다. 실제 seed layout에는 이미 non-crossing 위치가 있었는데, 보정 방향이 anchor 방향과 다를 수 있어 교차가 반복됐다.
- Why it was missed: edge-crossing unit test는 anchor 없는 X fixture만 사용했고, 실제 graph force chain에서 anchor-aware correction이 필요한지를 검증하지 않았다.
- Permanent guardrail: 추천인 그래프 crossing correction은 `anchorPositions`가 있으면 각 edge endpoint를 seed anchor 쪽으로 보정해야 한다. 실데이터 완료 기준은 crossing threshold 완화가 아니라 `RUN_REFERRAL_GRAPH_REALDATA_TEST=1`에서 `crossings=0`, `crossingVisualSeverity=0`이다.
- Related files: `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-layout.ts`, `web/src/lib/referral-graph-realdata.test.ts`, `web/src/lib/referral-graph-simulation.test.ts`, `web/src/components/referrals/ReferralGraphCanvas.tsx`
- Verification: `node --test src/lib/referral-graph-layout.test.ts src/lib/referral-graph-physics.test.ts src/lib/referral-graph-link-style.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`; `cd web; npm run lint`

## 2026-06-05 | Referral Graph Drag Suppression | 작은 드래그를 연결 컴포넌트 전체 이동으로 기록
- Symptom: 추천인 그래프에서 노드를 살짝 드래그했을 뿐인데 일부 노드가 멀리 튀고, 연결 edge가 비정상적으로 길어졌다.
- Root cause: `getDragAffectedNodeIds()`가 연결 컴포넌트 전체를 반환했고, `handleNodeDragEnd()`가 그 전체를 `userMovedNodeIdsRef`와 `dragMemorySuppressedNodeIdsRef`에 넣었다. 동시에 `applyReferralGraphDragSpring(... preventStretch)`는 실제 보정이 없는 edge의 follower까지 anchored로 등록해 deep stretched link까지 전파했다.
- Why it was missed: 초기 settle/정적 real-data QA는 통과했지만, 오래 열린 화면에서 작은 drag/release 후 force 전파와 anchor suppression이 어떻게 작동하는지 별도 테스트하지 않았다.
- Permanent guardrail: 노드 drag는 dragged node만 manual/suppressed로 기록한다. 연결 컴포넌트 전체를 suppressed 처리하지 않는다. drag spring의 stretch propagation은 실제 correction이 발생한 edge에서만 다음 edge로 전파한다. 실제 데이터 테스트에는 작은 drag 후 `maxEdge`, `minDistance`, crossing 악화 여부를 포함한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`, `web/src/lib/referral-graph-realdata.test.ts`
- Verification: `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`; `cd web; npm run lint`

## 2026-06-05 | Referral Graph Drag Reheat | 노드를 잡기만 해도 전체 simulation을 재가열
- Symptom: 추천인 그래프에서 노드를 한 번 드래그하거나 잡으면 그래프 전체가 불안정하게 흔들렸다.
- Root cause: `handleNodeDrag()` 첫 호출과 `handleNodeDragEnd()`가 `d3ReheatSimulation()`을 호출했다. `react-force-graph`의 drag callback은 자체적으로 노드 위치를 갱신하는데, 추가 reheat가 전체 force를 다시 과열시켜 안정된 배치를 흔들었다.
- Why it was missed: 이전 검증은 drag 후 edge 길이만 봤고, grab-only/tiny drag가 manual state나 simulation alpha에 남기는 효과를 분리하지 않았다.
- Permanent guardrail: node drag/dragEnd에서 전체 `d3ReheatSimulation()`을 호출하지 않는다. `onNodeDragEnd`의 total translate가 의미 있는 이동일 때만 manual target을 남기고, grab-only/tiny drag는 상태를 남기지 않는다. `isReferralGraphMeaningfulDrag` 테스트로 threshold를 고정한다.
- Related files: `web/src/components/referrals/ReferralGraphCanvas.tsx`, `web/src/lib/referral-graph-physics.ts`, `web/src/lib/referral-graph-physics.test.ts`
- Verification: `node --test src/lib/referral-graph-physics.test.ts src/lib/referral-graph-simulation.test.ts`; `$env:RUN_REFERRAL_GRAPH_REALDATA_TEST='1'; $env:LOG_REFERRAL_GRAPH_CROSSINGS='1'; node --test src/lib/referral-graph-realdata.test.ts`; `cd web; npm run lint`

## 2026-06-05 | Board Share Deep Link | 게시글 공유/홈 카드가 독립 상세 화면으로 진입
- Symptom: 홈 최신 가람Pick 카드와 공유 링크가 사용자가 기대한 게시판 상세 바텀시트가 아니라 `/board-detail` 독립 화면 또는 추천 초대 랜딩으로 열렸다.
- Root cause: 게시글 알림 라우트와 홈 최신 카드 라우트를 하나의 `resolveNoticeRoute()`로 묶었고, 공유 랜딩도 추천 초대 랜딩 fallback만 갖고 있었다. 홈/공유 진입은 기존 게시판 화면의 `postId` 모달 파라미터를 써야 한다는 계약이 분리되어 있지 않았다.
- Why it was missed: 게시판 상세 페이지가 열리는지만 확인하고, “목록 위 바텀시트로 열리는지”와 카카오/브라우저 랜딩이 실제 게시글 딥링크를 내리는지 확인하지 않았다.
- Permanent guardrail: 홈 최신 게시글은 `resolveHomeLatestNoticeRoute()`로 `/board?postId=...`에 진입한다. 외부 공유 URL은 `/board` 랜딩에서 `hanwhafcpass://board?postId=...`를 내려야 하며, 추천 초대 fallback과 섞지 않는다.
- Related files: `app/index.tsx`, `app/board.tsx`, `lib/notice-route.ts`, `lib/board-share-link.ts`, `invite-page/board.html`, `invite-page/vercel.json`
- Verification: `npm test -- --runTestsByPath lib\__tests__\notice-route.test.ts lib\__tests__\home-latest-notice.test.ts lib\__tests__\board-share-link.test.ts --runInBand`; invite-page production HTML contained `hanwhafcpass://board?postId` and not `board-detail`.

## 2026-06-05 | Notification Badge Source | 홈 배지가 알림 센터에 없는 live request_board unread까지 합산
- Symptom: 홈 벨 배지에는 5건이 표시됐지만 알림 센터 화면에는 4개 카드만 보여 사용자가 확인할 수 없는 알림 수가 남았다.
- Root cause: 홈 배지는 `request_board` live unread API를 더했고, 알림 센터는 `fc-notify inbox_list`의 로컬 notifications/notices만 렌더링했다. 두 화면이 서로 다른 source of truth를 사용했다.
- Why it was missed: 설계요청 알림을 추가할 때 unread count만 live API로 보강했고, 알림 센터 목록도 같은 데이터를 보여주는지 비교하지 않았다.
- Permanent guardrail: 모바일 배지는 알림 센터가 실제 렌더링하는 출처를 기준으로 센다. FC/일반 관리자는 `include_notices`, 설계매니저는 `only_request_board_categories`로 `fc-notify inbox_unread_count`가 목록 필터와 같은 기준을 사용해야 한다.
- Related files: `lib/mobile-unread-notification-count-plan.ts`, `supabase/functions/fc-notify/index.ts`, `supabase/functions/__tests__/fc-notify-inbox-unread.contract.test.ts`
- Verification: `npm test -- --runTestsByPath lib\__tests__\mobile-unread-notification-count-plan.test.ts supabase\functions\__tests__\fc-notify-inbox-unread.contract.test.ts --runInBand`; deployed `fc-notify`.
