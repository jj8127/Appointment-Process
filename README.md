# 가람in FC Onboarding Monorepo

가람PA지사의 FC 위촉/온보딩/운영 앱(`가람in`)과 관리자 웹을 함께 관리하는 모노레포입니다.

- 기준일: `2026-03-08`
- 운영 문서 SSOT: `AGENTS.md`
- 구성: Expo 모바일 앱 + Next.js 관리자 웹 + Supabase(Postgres/Storage/Edge Functions)

## 현재 스냅샷

- 인증은 Supabase Auth 기본 세션이 아니라 `전화번호 + 비밀번호` 커스텀 흐름과 `use-session` 상태를 기준으로 동작합니다.
- `가람in` 앱과 `가람Link(request_board)`는 계정 데이터를 연동하며, 최신 앱/함수 기준으로 request_board 세션도 자동 복구됩니다.
- FC 핵심 흐름은 `회원가입 -> 본인확인 -> 수당동의 -> 시험 신청 -> 서류 업로드 -> 위촉 -> 완료`입니다.
- 관리자/본부장 웹은 FC 현황, 시험, 서류, 공지, 채팅, 알림을 운영합니다.
- 민감정보는 암호화 저장과 서버 경유 조회를 원칙으로 합니다.

## 최근 반영 사항

- request_board 세션 자동 동기화 추가
  - 로그인 시 앱 세션 토큰 + request_board 브릿지 토큰 발급
  - 세션 복원 시 `sync-request-board-session`으로 request_board 세션 자동 재동기화
  - 복구 토큰이 전혀 없는 구세션은 1회 재로그인 유도
- 모바일 외부 링크 처리 정규화
  - 게시판/공지/설계요청의 HTTP(S) 링크를 `expo-web-browser` 인앱 브라우저로 열도록 통일
  - 유튜브 재생목록 링크 클릭 시 앱 이탈처럼 보이던 문제 방지
- 관리자 웹 푸시 딥링크 정규화
  - Chrome 알림 클릭 시 `/dashboard/chat?targetId=...&targetName=...`로 직접 이동
  - 기존 `/chat` 경로는 대시보드 채팅으로 리다이렉트

## 도메인 규칙

- `가람in`: `fc-onboarding-app` 앱/운영 시스템의 이름
- `가람Link`: `request_board` 서비스의 사용자 노출 이름
- `request_board`: 설계의뢰 시스템의 기술 저장소 이름
- `설계요청`: 화면/탭 기능명
- 위 이름들은 회사명/소속명/보험사명 데이터로 저장하지 않습니다.

## 역할 모델

- `fc`: 본인 온보딩 진행, 설계요청 생성 주체
- `manager`: FC 리더 역할, 설계요청 기준에서는 FC와 동일한 요청 주체
- `admin`: 총무/운영 역할, 승인/반려/공지/시험/서류 운영 담당
- `designer`: 보험사 설계 매니저, request_board에서 의뢰 수신/처리

## FC 상태 모델

소스: `types/fc.ts`

```ts
'draft'
| 'temp-id-issued'
| 'allowance-pending'
| 'allowance-consented'
| 'docs-requested'
| 'docs-pending'
| 'docs-submitted'
| 'docs-rejected'
| 'docs-approved'
| 'appointment-completed'
| 'final-link-sent'
```

## 저장소 구조

```text
fc-onboarding-app/
├── app/                    # Expo Router 화면
├── components/             # 공용 모바일 UI
├── hooks/                  # 세션/게이트/플랫폼 훅
├── lib/                    # Supabase/bridge/API 유틸
├── types/                  # 공용 타입
├── web/                    # Next.js 관리자 웹
├── supabase/
│   ├── schema.sql
│   ├── migrations/
│   └── functions/          # Edge Functions
├── docs/                   # 운영/배포/테스트 문서
├── contracts/              # API/DB/컴포넌트 계약
└── adr/                    # 아키텍처 결정 기록
```

## request_board 연동 포인트

- 앱 WebView/브릿지 진입 URL: `EXPO_PUBLIC_REQUEST_BOARD_URL`
- 비밀번호 동기화:
  - `supabase/functions/set-password`
  - `supabase/functions/reset-password`
  - `supabase/functions/login-with-password`
- 세션 동기화:
  - `supabase/functions/login-with-password`
  - `supabase/functions/sync-request-board-session`
  - `lib/request-board-api.ts`
  - `hooks/use-session.tsx`

운영상 주의:

- `REQUEST_BOARD_AUTH_BRIDGE_SECRET`과 request_board의 `FC_ONBOARDING_AUTH_BRIDGE_SECRET`은 반드시 동일해야 합니다.
- `REQUEST_BOARD_PASSWORD_SYNC_TOKEN`과 request_board의 `FC_ONBOARDING_PASSWORD_SYNC_TOKEN`도 반드시 동일해야 합니다.

## 환경 변수

### 루트 `.env`

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_REQUEST_BOARD_URL=...
```

### 웹 `web/.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:...
ADMIN_PUSH_SECRET=...
NEXT_PUBLIC_REQUEST_BOARD_URL=...
```

### Supabase Edge Function Secrets

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
REQUEST_BOARD_AUTH_BRIDGE_SECRET=...
REQUEST_BOARD_PASSWORD_SYNC_URL=...
REQUEST_BOARD_PASSWORD_SYNC_TOKEN=...
ADMIN_WEB_URL=...
ADMIN_PUSH_SECRET=...
```

## 실행 명령

### 모바일 앱

```bash
npm install
npm start
npm run android
npm run ios
npm run lint
npm test
npm run test:coverage
```

### 관리자 웹

```bash
cd web
npm install
npm run dev
npm run build
npm run lint
```

### Supabase

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy login-with-password --project-ref <project-ref>
supabase functions deploy sync-request-board-session --project-ref <project-ref>
```

### 검증

```bash
npx jest lib/__tests__/external-url.test.ts
npx jest lib/__tests__/request-board-session.test.ts
npx tsc --noEmit
node scripts/ci/check-governance.mjs
```

## 운영 가드레일

1. 주민번호 평문은 DB/로그/클라이언트에 직접 저장하지 않습니다.
2. 관리자 쓰기 경로는 서버 API 또는 Edge Function 경유만 허용합니다.
3. `manager`는 읽기 중심 역할을 유지하고, 관리자 전용 쓰기 권한을 부여하지 않습니다.
4. 스키마 변경 시 `supabase/schema.sql`과 `supabase/migrations/*.sql`를 함께 관리합니다.
5. request_board 연동 변경 시 앱 코드, Edge Function, 관련 문서를 같은 변경 세트로 맞춥니다.

## 참고 문서

- 운영 기준: `AGENTS.md`
- 작업 로그: `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- 문서 인덱스: `docs/README.md`
- 아키텍처 결정: `adr/README.md`
- 관리자 웹 안내: `web/README.md`
