# 작업 로그

> AI Agent는 매 세션 시작 시 이 파일을 먼저 읽고, 작업 시작 전에 최신 앵커를 확인하세요.
> 상세 이력: [WORK_DETAIL.md](WORK_DETAIL.md)

---

## 프로젝트 현황
- 범위: 최근 1개월 Git 이력 기반 문서화 완료 (`2026-01-12` ~ `2026-02-11`, 총 44 commits)
- 현재 포커스: 앱/웹 권한(RLS) 우회 경로 안정화, 알림/공지/시험 도메인 UX 정리
- 운영 스택: Expo 앱 + Next.js 웹 + Supabase(Edge Functions/RLS)

## 주의사항
- ⚠️ 모바일은 Supabase Auth 세션이 아닌 커스텀 세션(`residentId`, `role`) 기반으로 동작
- ⚠️ 관리자 쓰기 작업은 클라이언트 직접 DB 갱신 대신 Edge Function(`admin-action`) 경유 원칙 유지
- ⚠️ 민감정보(주민번호)는 암호화 저장/전용 API 조회 원칙 준수
- ⚠️ 상태값(`types/fc.ts`)과 화면 분기 조건은 반드시 함께 수정
- ⚠️ 스키마 변경은 `schema.sql` + `migrations/*.sql` 동시 관리

## 최근 작업
| 날짜 | 작업 | 핵심 파일 | 상세 |
|------|------|----------|------|
| 02-27 | 소속-본부장 매핑 테이블 도입(알림 수신 정확도 강화) | `supabase/migrations/20260227000008_add_affiliation_manager_mappings.sql`, `supabase/schema.sql`, `supabase/functions/fc-notify/index.ts`, `supabase/functions/delete-account/index.ts`, `docs/guides/COMMANDS.md` | [→ 상세](WORK_DETAIL.md#20260227-15) |
| 02-27 | 알림 inbox 기준 통일(위촉/설계요청) + 본부장 FC업데이트 수신 범위 제한 | `app/index.tsx`, `app/request-board.tsx`, `app/notifications.tsx`, `supabase/functions/fc-notify/index.ts` | [→ 상세](WORK_DETAIL.md#20260227-14) |
| 02-27 | 알림 배지 UI 깨짐 보정(폰트 스케일 고정) | `components/AppTopActionBar.tsx` | [→ 상세](WORK_DETAIL.md#20260227-13) |
| 02-27 | 설계요청 현황 카드 탭 -> 단계 필터 목록 연동 | `app/request-board.tsx`, `app/request-board-requests.tsx` | [→ 상세](WORK_DETAIL.md#20260227-12) |
| 02-27 | 환영문구 폰트 추가 축소 | `components/AppTopActionBar.tsx` | [→ 상세](WORK_DETAIL.md#20260227-11) |
| 02-27 | 게시글 조회수 집계 기준 전환(조회 이벤트 누적) | `supabase/functions/board-detail/index.ts`, `supabase/schema.sql`, `supabase/migrations/20260227000007_allow_repeated_board_views.sql` | [→ 상세](WORK_DETAIL.md#20260227-10) |
| 02-27 | 헤더 타이틀 축소 + 게시판(관리) 동일 헤더 적용 | `components/AppTopActionBar.tsx`, `app/admin-board-manage.tsx` | [→ 상세](WORK_DETAIL.md#20260227-9) |
| 02-27 | 상단 헤더 1행 재배치(알림-환영문구-로그아웃) | `components/AppTopActionBar.tsx`, `app/index.tsx`, `app/request-board.tsx`, `app/board.tsx` | [→ 상세](WORK_DETAIL.md#20260227-8) |
| 02-27 | 게시판 카테고리+제목 동일 행 정렬 | `app/admin-board-manage.tsx`, `app/board.tsx` | [→ 상세](WORK_DETAIL.md#20260227-7) |
| 02-27 | 게시판 공지 우선 표시 + 게시글 조회수 추적/노출 | `app/admin-board-manage.tsx`, `app/board.tsx`, `supabase/functions/board-detail/index.ts`, `supabase/functions/board-list/index.ts`, `supabase/schema.sql`, `supabase/migrations/20260227000006_add_board_post_views.sql`, `lib/board-api.ts`, `web/src/lib/board-api.ts`, `contracts/api-contracts.md` | [→ 상세](WORK_DETAIL.md#20260227-6) |
| 02-27 | 위촉/시험/설계요청 섹션 타이틀 중앙 정렬 | `app/index.tsx`, `app/request-board.tsx` | [→ 상세](WORK_DETAIL.md#20260227-5) |
| 02-27 | 홈/설계요청 종 아이콘 미확인 배지 기준 통일 | `app/request-board.tsx` | [→ 상세](WORK_DETAIL.md#20260227-4) |
| 02-27 | 설계 매니저 환영 문구 적용 | `lib/welcome-title.ts`, `app/index.tsx`, `app/request-board.tsx`, `app/board.tsx` | [→ 상세](WORK_DETAIL.md#20260227-3) |
| 02-27 | 시험 일정 삭제 버튼 미동작 수정(생명/손해) | `app/exam-register.tsx`, `app/exam-register2.tsx` | [→ 상세](WORK_DETAIL.md#20260227-2) |
| 02-27 | 앱 상단 헤더 공통화(위촉/시험/설계요청/게시판) + 우측 새로고침 제거 | `components/AppTopActionBar.tsx`, `lib/welcome-title.ts`, `app/index.tsx`, `app/request-board.tsx`, `app/board.tsx` | [→ 상세](WORK_DETAIL.md#20260227-1) |
| 02-26 | 남은 BLOCKED 42건 전수 PASS 마감(SET-01/RB-01/04/07 포함) | `scripts/testing/run-remaining-blocked-cli.mjs`, `supabase/functions/delete-account/index.ts`, `app/settings.tsx`, `web/src/app/dashboard/settings/page.tsx`, `contracts/api-contracts.md`, `docs/testing/INTEGRATED_TEST_RUN_RESULT.json` | [→ 상세](WORK_DETAIL.md#20260226-12) |
| 02-26 | Push 거버넌스 실패 재발 방지 문서화 + schema sync marker 추가 | `AGENTS.md`, `docs/guides/COMMANDS.md`, `supabase/schema.sql`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260226-11) |
| 02-26 | BLOCKED 역할순 실행(FC→본부장→총무→설계매니저) 자동검증 + PASS 전환 8건 | `scripts/testing/run-fc-blocked-cli.mjs`, `scripts/testing/run-manager-blocked-cli.mjs`, `scripts/testing/run-admin-blocked-cli.mjs`, `scripts/testing/run-designer-blocked-cli.mjs`, `docs/testing/INTEGRATED_TEST_RUN_RESULT.json`, `docs/testing/evidence/*`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260226-10) |
| 02-26 | 통합 테스트 실행체계 구축(누락 방지) | `docs/testing/INTEGRATED_TEST_CHECKLIST.md`, `docs/testing/integrated-test-cases.json`, `scripts/testing/init-integrated-test-run.mjs`, `scripts/testing/validate-integrated-test-run.mjs`, `package.json`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260226-9) |
| 02-26 | 모바일 하단 네비 정책 보정(총무/본부장 5탭 고정 + 설계매니저 2탭 유지) | `components/BottomNavigation.tsx`, `lib/bottom-navigation.ts`, `app/index.tsx`, `lib/__tests__/bottom-navigation.test.ts`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260226-8) |
| 02-26 | 모바일 하단 네비 SSOT 통일(총무/본부장/FC/설계매니저 공통 규칙) | `lib/bottom-navigation.ts`, `components/BottomNavigation.tsx`, `app/index.tsx`, `app/board.tsx`, `app/admin-board-manage.tsx`, `app/notice.tsx`, `app/settings.tsx`, `app/request-board.tsx`, `app/request-board-fc-codes.tsx`, `lib/__tests__/bottom-navigation.test.ts`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260226-7) |
| 02-26 | 앱 게시판 카드/상세 카테고리 유형 배지 추가 + request_board 계정 자동 생성 동기화 보강 | `app/board.tsx`, `supabase/functions/login-with-password/index.ts`, `supabase/functions/set-password/index.ts`, `supabase/functions/reset-password/index.ts`, `supabase/functions/set-admin-password/index.ts` | [→ 상세](WORK_DETAIL.md#20260226-6) |
| 02-26 | 설계요청 탭 의뢰 현황 통계카드(FC/설계매니저) + 설계코드 관리 화면 추가 | `app/request-board.tsx`, `lib/request-board-api.ts`, `app/request-board-fc-codes.tsx` | 작업직접 |
| 02-26 | 부분 위촉 가입 Step 오분류/잠금 회귀 수정(1단계 시작 + 상태전환 보정 + 데이터 보정 migration) | `supabase/functions/set-password/index.ts`, `supabase/functions/_shared/commission.ts`, `app/index.tsx`, `app/dashboard.tsx`, `web/src/lib/shared.ts`, `web/src/app/dashboard/appointment/actions.ts`, `web/src/app/dashboard/page.tsx`, `supabase/functions/admin-action/index.ts`, `supabase/migrations/20260226000004_fix_partial_commission_signup_status.sql`, `lib/__tests__/commission.test.ts`, `lib/__tests__/workflow-step-regression.test.ts` | [→ 상세](WORK_DETAIL.md#20260226-5) |
| 02-26 | 관리자 웹 헤더 벨 알림센터 추가 + 사이드바 알림/공지 제거(클릭 이동/확인 카운트 차감) | `web/src/components/DashboardNotificationBell.tsx`, `web/src/app/dashboard/layout.tsx`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260226-4) |
| 02-26 | FC 가람지사 메신저 대상 목록/총무 채팅 복구(RLS 우회 + targetId=admin 처리) | `app/chat.tsx`, `supabase/functions/fc-notify/index.ts`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260226-3) |
| 02-26 | 앱 게시판 관리 목록 카테고리 표시 추가(공지/교육 등) | `app/admin-board-manage.tsx`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260226-2) |
| 02-26 | 관리자 웹 공지/게시판 공지 일관화(통합 목록 + 게시판 딥링크 + 삭제 경로 통합) | `web/src/app/api/admin/notices/route.ts`, `web/src/app/dashboard/notifications/page.tsx`, `web/src/app/dashboard/notifications/[id]/page.tsx`, `web/src/app/dashboard/notifications/[id]/edit/page.tsx`, `web/src/app/dashboard/board/page.tsx`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260226-1) |
| 02-25 | FC 삭제 완전 정리 보강(웹/엣지/fallback 경로 통합) | `web/src/app/api/fc-delete/route.ts`, `supabase/functions/delete-account/index.ts`, `supabase/functions/admin-action/index.ts`, `web/src/app/dashboard/settings/page.tsx`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260225-16) |
| 02-25 | 웹 빌드 타입 오류 핫픽스(`calcStep` 불필요 분기 제거) | `web/src/lib/shared.ts`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260225-15) |
| 02-25 | FC 위촉 2트랙(생명/손해) 완료 상태 분기 도입 + 홈/총무 Step 정렬 | `app/signup.tsx`, `app/index.tsx`, `supabase/functions/set-password/index.ts`, `web/src/lib/shared.ts`, `web/src/app/dashboard/page.tsx`, `supabase/schema.sql` | [→ 상세](WORK_DETAIL.md#20260225-14) |
| 02-25 | request_board 본부장(FC 리더) 브릿지 권한 정렬 + 재테스트 완료 | `hooks/use-login.ts`, `hooks/use-session.tsx`, `app/request-board.tsx`, `app/notifications.tsx`, `supabase/functions/login-with-password/index.ts` | [→ 상세](WORK_DETAIL.md#20260225-13) |
| 02-25 | 거버넌스 CI 복구: WORK_LOG/WORK_DETAIL 동시 갱신 + schema/migration 동기화(no-op) 반영 | `supabase/schema.sql`, `supabase/migrations/20260225000002_schema_sync_notices_created_by.sql`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` | [→ 상세](WORK_DETAIL.md#20260225-12) |
| 02-25 | request_board 메신저 첨부파일 UI 완성(이미지/문서 선택, 업로드 후 전송, 메시지 내 썸네일/파일카드/이미지 확대 미리보기) + 타입 정리(implicit any 제거) | `app/request-board-messenger.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260225-11) |
| 02-25 | 알림 출처 구분 강화(온보딩앱 vs 설계요청): request_board 푸시에 `[설계요청]` 접두 + 앱 알림센터 출처 배지/카테고리 라벨 적용 | `supabase/functions/fc-notify/index.ts`, `app/notifications.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260225-10) |
| 02-25 | `fc-notify` 대상번호(`target_id`) role 무관 통합 발송 확장(FC/Admin/Manager) + 중복토큰 제거 | `supabase/functions/fc-notify/index.ts`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260225-9) |
| 02-24 | 데스크톱 알림 미표시 대응: 서비스워커/정적자산 공개 경로 보정 + sw 푸시 파싱 보강 + 테스트 알림 아이콘 경로 수정 | `web/middleware.ts`, `web/public/sw.js`, `web/src/app/dashboard/page.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-8) |
| 02-24 | 데스크톱 알림 미표시 진단 보강(web_push 콜백 결과 응답 + 대시보드 알림 테스트 버튼) | `supabase/functions/fc-notify/index.ts`, `web/src/app/dashboard/page.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-7) |
| 02-24 | 대시보드 상단에 웹 알림 설정 버튼 추가(권한 요청/재등록) | `web/src/app/dashboard/page.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-6) |
| 02-24 | 설정 페이지에 웹 알림 권한 버튼/상태 UI 추가 및 수동 재등록 지원 | `web/src/components/WebPushRegistrar.tsx`, `web/src/app/dashboard/settings/page.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-5) |
| 02-24 | 총무 웹푸시 미수신 복구(토큰 비교 정규화 + Vercel env 재주입 + 프로덕션 재배포) | `web/src/app/api/admin/push/route.ts`, `web/src/lib/web-push.ts`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-4) |
| 02-24 | 웹푸시 VAPID env 포맷 오류 방어(\\n/공백/따옴표 정규화 + 유효성 로그) | `web/src/lib/web-push.ts`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-3) |
| 02-24 | 앱→총무 채팅 웹푸시 누락 대응(콜백 URL 정규화, 인증 fallback, 실패 로그 가시화) | `supabase/functions/fc-notify/index.ts`, `web/src/app/api/admin/push/route.ts`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260224-2) |
| 02-24 | 어드민 브라우저 웹 푸시 알림 추가 (FC 서류/동의/시험/채팅 → 어드민 OS 알림) | `web/src/app/api/admin/push/route.ts`, `supabase/functions/fc-notify/index.ts`, `web/src/app/api/fc-notify/route.ts`, `web/src/app/api/web-push/subscribe/route.ts` | [→ 상세](WORK_DETAIL.md#20260224-1) |
| 02-20 | 모바일 시험 신청(생명/손해) 마감 필터 기준 통일 및 당겨서 새로고침 제스처 복구 | `app/exam-apply.tsx`, `app/exam-apply2.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260220-1) |
| 02-19 | 웹 대시보드 서류 배지의 "검토 중" 카운트를 제출 문서 기준으로 보정 | `web/src/app/dashboard/page.tsx` | [→ 상세](WORK_DETAIL.md#20260219-8) |
| 02-19 | 웹 FC 상세 페이지에서 프로필/관리자 메모 수정 경로를 서버 API로 전환하고 관리자만 수정 가능하도록 권한 제어 보강 | `web/src/app/dashboard/profile/[id]/page.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260219-7) |
| 02-19 | 주민번호 표기 경로 전반에서 마스킹 fallback 제거 및 관리자 화면 전체번호 조회 확장 | `supabase/functions/admin-action/index.ts`, `web/src/app/dashboard/exam/applicants/page.tsx`, `web/src/app/dashboard/profile/[id]/page.tsx`, `app/exam-manage.tsx`, `app/exam-manage2.tsx`, `app/fc/new.tsx` | [→ 상세](WORK_DETAIL.md#20260219-6) |
| 02-19 | WORK_LOG 최근 작업 행수 제한 제거(정책/CI 동기화) | `AGENTS.md`, `.claude/PROJECT_GUIDE.md`, `scripts/ci/check-governance.mjs` | [→ 상세](WORK_DETAIL.md#20260219-5) |
| 02-19 | 관리자 웹 서류 탭에서 미제출 항목 노출 필터 보정 | `web/src/app/dashboard/page.tsx` | [→ 상세](WORK_DETAIL.md#20260219-4) |
| 02-19 | 웹 FC 상세에서 관리자 주민번호 원문 조회 표시 연동 | `web/src/app/dashboard/profile/[id]/page.tsx` | [→ 상세](WORK_DETAIL.md#20260219-3) |
| 02-19 | 수당동의 임시사번 선검증 및 계정 중복 차단 강화 | `app/consent.tsx`, `supabase/functions/fc-consent/index.ts`, `supabase/functions/set-password/index.ts` | [→ 상세](WORK_DETAIL.md#20260219-2) |
| 02-19 | 회원가입 사전 중복검증/홈 플로우 안정화 및 AGENTS 거버넌스 문서 추가 | `app/signup.tsx`, `supabase/functions/request-signup-otp/index.ts`, `app/index.tsx`, `AGENTS.md` | [→ 상세](WORK_DETAIL.md#20260219-1) |
| 02-11 | iOS 빌드 번들ID 등록 실패(Apple Maintenance) 대응 | `docs/guides/명령어 모음집.txt` | [→ 상세](WORK_DETAIL.md#20260211-16) |
| 02-11 | Android 릴리즈 난독화/리소스 축소 설정 반영 | `app.json` | [→ 상세](WORK_DETAIL.md#20260211-15) |
| 02-11 | 정책/보안 정리(B): 로컬 산출물/설정 추적 해제 | `.gitignore`, `.codex/config.toml`, `testsprite_tests/*` | [→ 상세](WORK_DETAIL.md#20260211-14) |
| 02-11 | 안전 묶음(A): 빌드 산출물/미사용 모듈 정리 | `dist-web-new2/*`, `app/admin-register.tsx`, `components/*` | [→ 상세](WORK_DETAIL.md#20260211-13) |
| 02-11 | 앱/웹 미점검 영역 종합 점검 및 안정화 패치 | `app/index.tsx`, `app/_layout.tsx`, `jest.config.js` | [→ 상세](WORK_DETAIL.md#20260211-12) |
| 02-11 | 문서 거버넌스 CI/PR 강제 및 SSOT 정리 | `.github/workflows/governance-check.yml`, `.claude/PROJECT_GUIDE.md` | [→ 상세](WORK_DETAIL.md#20260211-11) |
| 02-11 | 시험 접수 마감 기준을 당일 23:59:59로 보정 | `app/exam-apply.tsx`, `web/src/app/dashboard/exam/schedule/page.tsx` | [→ 상세](WORK_DETAIL.md#20260211-10) |
| 02-11 | 서류 마감일(18:00 기준) 알림 로직 정합성 보정 | `supabase/functions/docs-deadline-reminder/index.ts`, `web/src/app/api/admin/fc/route.ts` | [→ 상세](WORK_DETAIL.md#20260211-9) |
| 02-11 | 임시번호 발급 알림 탭 시 수당 동의 페이지 이동 보정 | `app/notifications.tsx` | [→ 상세](WORK_DETAIL.md#20260211-8) |
| 02-11 | 알림센터 저장 누락(푸시만 수신) 대응 | `supabase/functions/fc-notify/index.ts`, `web/src/app/actions.ts` | [→ 상세](WORK_DETAIL.md#20260211-7) |
| 02-11 | FC 사전등록 안내 화면 임시 공지/알림 섹션 제거 | `app/apply-gate.tsx` | [→ 상세](WORK_DETAIL.md#20260211-6) |
| 02-11 | FC 사전등록 공지/알림 접근 개선 및 CORS 기본값 보정 | `app/apply-gate.tsx`, `supabase/functions/fc-notify/index.ts` | [→ 상세](WORK_DETAIL.md#20260211-5) |
| 02-11 | 웹 공지 상세 페이지 및 목록 행 클릭 이동 구현 | `web/src/app/dashboard/notifications/page.tsx` | [→ 상세](WORK_DETAIL.md#20260211-1) |
| 02-11 | 웹 공지 조회를 서버 API 경유로 전환(RLS 우회) | `web/src/app/api/admin/notices/route.ts` | [→ 상세](WORK_DETAIL.md#20260211-2) |
| 02-11 | 앱 공지 페이지를 `fc-notify` 기반 조회로 전환 | `app/notice.tsx` | [→ 상세](WORK_DETAIL.md#20260211-3) |
| 02-11 | 계정 삭제 플로우 fail-safe 보강 | `app/settings.tsx`, `supabase/functions/delete-account/index.ts` | [→ 상세](WORK_DETAIL.md#20260211-4) |
| 02-10 | Windows 환경 Next.js dev lockfile 충돌 완화 | `web/scripts/clean-next.mjs` | [→ 상세](WORK_DETAIL.md#20260210-1) |
| 02-10 | 웹 세션 쿠키 동기화 및 API 인증 안정화 | `web/src/hooks/use-session.tsx` | [→ 상세](WORK_DETAIL.md#20260210-2) |
| 02-10 | 시험 신청자 화면 UX/타입/주민번호 표시 개선 | `web/src/app/dashboard/exam/applicants/page.tsx` | [→ 상세](WORK_DETAIL.md#20260210-3) |
| 02-10 | 시험 일정 null 날짜(미정) 처리 및 연계 안정화 | `types/exam.ts`, `app/exam-apply.tsx` | [→ 상세](WORK_DETAIL.md#20260210-4) |
| 02-10 | 대시보드 사이드바 토글/호버 확장 UX 도입 | `web/src/components/layout/Sidebar.tsx` | [→ 상세](WORK_DETAIL.md#20260210-5) |
| 02-09 | 앱/웹 누적 미반영 수정 일괄 반영 | `app/*`, `web/src/app/dashboard/*` | [→ 상세](WORK_DETAIL.md#20260209-1) |
| 02-05 | 온보딩 플로우 및 관리자 대시보드 대규모 업데이트 | `app/dashboard.tsx`, `supabase/functions/admin-action/index.ts` | [→ 상세](WORK_DETAIL.md#20260205-1) |
| 02-05 | 서비스 계정/앱 키 파일 Git 관리 정책 조정 | `.gitignore` | [→ 상세](WORK_DETAIL.md#20260205-2) |
| 01-29 | 미등록 계정 로그인/재설정 처리 및 FC 삭제 개선 | `supabase/functions/login-with-password/index.ts` | [→ 상세](WORK_DETAIL.md#20260129-1) |
| 01-26 | `fc-delete` API cookies 비동기 처리 보정 | `web/src/app/api/fc-delete/route.ts` | [→ 상세](WORK_DETAIL.md#20260126-1) |
| 01-26 | 동의/서류/일정/알림 액션 흐름 개선 | `app/consent.tsx`, `app/appointment.tsx` | [→ 상세](WORK_DETAIL.md#20260126-2) |
| 01-26 | 앱 브랜딩 자산 및 일부 삭제 경로 조정 | `assets/*`, `app/dashboard.tsx` | [→ 상세](WORK_DETAIL.md#20260126-3) |
| 01-21 | 모바일 게시판 홈 네비게이션 동선 조정 | `app/board-home.tsx` | [→ 상세](WORK_DETAIL.md#20260121-1) |
