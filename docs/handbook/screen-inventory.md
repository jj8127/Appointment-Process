doc_id: FC-HANDBOOK-SCREEN-INVENTORY
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-03-28
source_of_truth: app/* + web/src/app/*

# 화면 인벤토리

## Mobile

- 인증/게이트: `login`, `signup`, `signup-verify`, `signup-password`, `reset-password`, `apply-gate`, `identity`
- FC: `index`, `home-lite`, `fc/new`, `consent`, `docs-upload`, `hanwha-commission`, `appointment`, `exam-apply`, `exam-apply2`
- 공용/콘텐츠: `settings`, `notifications`, `notice`, `notice-detail`, `board`, `board-detail`, `messenger`, `chat`
- GaramLink 연동: `request-board`, `request-board-messenger`, `request-board-requests`, `request-board-review`, `request-board-fc-codes`
- Admin/Manager: `dashboard`, `exam-register`, `exam-register2`, `exam-manage`, `exam-manage2`, `admin-notice`, `admin-board`, `admin-board-manage`, `admin-messenger`

## Admin Web

- 핵심 운영: `/dashboard`, `/dashboard/profile/[id]`, `/dashboard/docs`, `/dashboard/appointment`
- 공지/게시판: `/dashboard/notifications/*`, `/dashboard/board`
- 시험: `/dashboard/exam/schedule`, `/dashboard/exam/applicants`, `/admin/exams/*`
- 추천인: `/dashboard/referrals`
- 메신저/채팅: `/dashboard/messenger`, `/dashboard/chat`
- 운영 보조: `/dashboard/settings`, `/dashboard/profile`, `/auth`

## 우선 문서화 화면군

- `dashboard`
- `docs-upload`
- `appointment`
- `exam-*`
- `request-board*`
- `messenger` / `chat`
- `board*` / `notice*`
