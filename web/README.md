# 가람in Admin Web

`web/`은 가람in 운영용 관리자 웹입니다. FC/본부장/총무 운영 화면, 관리자 API 라우트, 브라우저 웹 푸시를 포함합니다.

- 기준일: `2026-03-08`
- 프레임워크: Next.js 16 App Router
- UI: Mantine + TanStack Query

## 주요 역할

- `admin`
  - FC 현황 관리
  - 시험/서류/공지 운영
  - 관리자 웹 푸시 수신
- `manager`
  - 대시보드/공지/채팅 조회 중심
  - 예외적으로 공지는 작성 가능하지만, 관리자 전용 운영 쓰기 권한을 그대로 받지는 않습니다.

## 핵심 화면

- `src/app/auth/page.tsx`
  - 관리자/본부장 로그인
- `src/app/dashboard/page.tsx`
  - 메인 대시보드
- `src/app/dashboard/profile/[id]/page.tsx`
  - FC 상세/메모/민감정보 조회 경로
- `src/app/dashboard/exam/*`
  - 시험 일정/신청자 관리
- `src/app/dashboard/docs/*`
  - 서류 요청/검토
- `src/app/dashboard/notifications/*`
  - 공지 관리
- `src/app/dashboard/chat/page.tsx`
  - 관리자 채팅
- `src/app/dashboard/messenger/page.tsx`
  - request_board 메신저 브릿지 진입

## 최근 반영 사항

- Chrome/브라우저 푸시 클릭 시 관리자 채팅 딥링크를 `/dashboard/chat?targetId=...&targetName=...`로 정규화했습니다.
- 기존 `/chat` 접근은 대시보드 채팅으로 리다이렉트합니다.
- 브라우저 푸시는 `ADMIN_PUSH_SECRET` 기반 콜백과 VAPID 설정을 사용합니다.

## 환경 변수

`web/.env.local`

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

## 실행 명령

```bash
cd web
npm install
npm run dev
npm run build
npm run start
npm run lint
```

## 운영 체크포인트

- 관리자 푸시 콜백 라우트: `src/app/api/admin/push/route.ts`
- FC 알림 프록시 라우트: `src/app/api/fc-notify/route.ts`
- request_board 딥링크 정규화: `src/lib/admin-chat-url.ts`
- 서비스 워커: `public/sw.js`

## 참고

- 루트 운영 기준: `../AGENTS.md`
- 루트 개요: `../README.md`
