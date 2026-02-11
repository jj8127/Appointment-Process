# 작업 로그

> AI Agent는 매 세션 시작 시 이 파일을 먼저 읽고, 작업 시작 전에 최신 앵커를 확인하세요. (200줄 이하 유지)
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
| 01-21 | Supabase Security Advisor 권고 반영 | `supabase/schema.sql` | [→ 상세](WORK_DETAIL.md#20260121-2) |
| 01-20 | 하단 내비 컴포넌트 도입 및 설정 화면 정리 | `components/BottomNav.tsx`, `app/settings.tsx` | [→ 상세](WORK_DETAIL.md#20260120-1) |
| 01-19 | 게시판 고도화 + Claude Skills/Subagent 체계 도입 | `app/board*.tsx`, `.claude/*` | [→ 상세](WORK_DETAIL.md#20260119-1) |
| 01-17 | 웹 빌드(TypeScript) 오류 수정 | `web/src/*` | [→ 상세](WORK_DETAIL.md#20260117-1) |
| 01-17 | 게시판 기능(앱/웹 + Functions) 대규모 도입 | `web/src/app/dashboard/board/*`, `supabase/functions/board-*` | [→ 상세](WORK_DETAIL.md#20260117-2) |
| 01-13 | 문서 최신화 및 Manager 읽기 전용 UI 보강 | `AI.md`, `web/src/app/dashboard/page.tsx` | [→ 상세](WORK_DETAIL.md#20260113-1) |
