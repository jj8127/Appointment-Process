doc_id: FC-HANDBOOK-SCREEN-INVENTORY
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-08-08
source_of_truth: app/* + web/src/app/*

# 화면 인벤토리

## Mobile

- 인증/게이트: `login`, `signup`, `signup-verify`, `signup-password`, `reset-password`, `apply-gate`, `identity`
- 모두온 공통 서비스: `index`(공개 홈, 명시적 보험 mode/홈 알림 문맥은 기존 FC 홈), `services/index`, `services/[service]`(보험·가족간병·통신·렌탈·자동차·제휴병원), `services/login`, `services/signup`, `services/application`, `services/activity`, `services/account`, `services/hospitals`, `services/manage`
- FC: `home-lite`, `fc/new`, `consent`, `docs-upload`, `hanwha-commission`, `appointment`, `exam-apply`, `exam-apply2`, `referral`, `referral-tree`(redirect), `referral-graph`, `referral-revenue-graph`(local sample)
- 공용/콘텐츠: `settings`, `notifications`, `notice`, `notice-detail`, `board`, `board-detail`, `messenger`, `messenger-search`, `new-conversation`, `chat`, `group-chat`, `notification-settings`, `muted-conversations`
- GaramLink 연동: `request-board`, `request-board-messenger`, `request-board-requests`, `request-board-review`, `request-board-fc-codes`
- Admin/Manager: `dashboard`, `exam-register`, `exam-register2`, `exam-manage`, `exam-manage2`, `admin-notice`, `admin-board`, `admin-board-manage`, `admin-messenger`

2026-10-11 브랜드: 공통 홈·가입·로그인은 모두온 심볼과 이름을 사용하며 보험 업무만 가람in을 유지한다. 기기 전체 알림 권한/설정 안내도 모두온으로 표시한다. 앱 표시명·아이콘·시작 화면은 `app.json`과 `assets/images/moduon/`가 기준이며 이미 설치된 앱의 이름·아이콘에는 새 네이티브 빌드가 필요하다.

The archived Figma foundation board contains the former 42-route inventory.
Messenger V2 added the five routes `messenger-search`, `new-conversation`,
`group-chat`, `notification-settings`, and `muted-conversations`; these are the
required 42 → 47 delta for the next live Figma Phase 0 reconciliation. The
existing SVG route cards remain inventory artifacts, not Component Sets.

## Admin Web

- 핵심 운영: `/dashboard`, `/dashboard/profile/[id]`, `/dashboard/docs`, `/dashboard/appointment`
- 공지/게시판: `/dashboard/notifications/*`, `/dashboard/board`
- 시험: `/dashboard/exam/schedule`, `/dashboard/exam/applicants`, `/admin/exams/*`
- 추천인: `/dashboard/referrals`
- 메신저/채팅: `/dashboard/messenger`, `/dashboard/chat`
- 운영 보조: `/dashboard/settings`, `/dashboard/profile`, `/auth`
- `/dashboard/settings` account-deletion failures retain the existing user notification but emit only a fixed message through the sanitized web logger; raw exceptions never reach a direct console sink.

## 우선 문서화 화면군

- `dashboard`
- `docs-upload`
- `appointment`
- `exam-*`
- `request-board*`
- `messenger` / `chat`
- `board*` / `notice*`
