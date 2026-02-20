# 가람 in FC Onboarding Monorepo

보험 FC(설계사) 온보딩을 모바일 앱(Expo)과 관리자 웹(Next.js)에서 통합 운영하는 모노레포입니다.

- 앱 이름: `가람 in`
- 모바일 앱 버전: `1.4.6` (`app.json`)
- 기준일: `2026-02-20`

## 1. 현재 프로젝트 스냅샷

- 아키텍처: Expo 모바일 + Next.js 관리자 웹 + Supabase(Postgres/Storage/Edge Functions)
- 인증: Supabase Auth 세션 중심이 아니라 `전화번호 + 비밀번호` 커스텀 인증 흐름과 `use-session` 상태를 기준으로 동작
- 핵심 흐름: 회원가입/OTP/비밀번호 -> 신원확인 -> 임시사번 -> 수당동의 -> 시험 -> 서류 -> 위촉 -> 완료
- 보안 포인트: 주민번호 평문 저장 금지, 민감 정보는 암호화 저장 + service-role 경유 조회
- 운영 원칙: 관리자 쓰기 작업은 서버 API 또는 Edge Function 경유, RLS 제약 우회 클라이언트 쓰기 금지

## 2. 역할과 권한 모델

- `fc`: 회원가입, 본인 정보/동의/시험 신청/서류 업로드/위촉 제출
- `admin`: FC 상태 변경, 승인/반려, 공지/알림, 시험/서류 운영
- `manager`: 기본적으로 읽기 중심 운영
- 예외: 웹 공지(`dashboard/notifications`)는 `manager`도 작성 가능하며, 본인 작성 글에 한해 수정/삭제 가능

## 3. FC 온보딩 상태값 (Source of Truth)

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

### 실제 업무 플로우

1. 회원가입 및 OTP 인증
2. 비밀번호 설정/로그인
3. 신원확인 및 기본 정보 입력
4. 임시사번 발급
5. 수당 동의 및 승인
6. 시험 일정 조회/신청(생명/손해)
7. 서류 요청/업로드/심사
8. 위촉 일정 제출/완료 처리
9. 최종 링크 발송 및 종료

## 4. 리포지토리 구조

```txt
fc-onboarding-app/
├── app/                    # 모바일 라우트(Expo Router)
├── components/             # 모바일 공용 UI
├── hooks/                  # 세션/게이트/플랫폼 훅
├── lib/                    # Supabase, logger, 유틸
├── types/                  # 공용 타입 (FC 상태 포함)
├── web/                    # 관리자 웹 (Next.js App Router)
│   └── src/app/
├── supabase/
│   ├── schema.sql
│   ├── migrations/
│   └── functions/          # Deno Edge Functions
├── contracts/              # API/DB/컴포넌트 계약 문서
└── adr/                    # 아키텍처 결정 기록
```

## 5. 주요 화면/엔트리

### 모바일 (`app/*`)

- 라우트/프로바이더 엔트리: `app/_layout.tsx`
- 로그인: `app/login.tsx`
- 회원가입: `app/signup.tsx`, `app/signup-verify.tsx`, `app/signup-password.tsx`
- 신원/기본정보: `app/identity.tsx`, `app/fc/new.tsx`
- 수당동의: `app/consent.tsx`
- 시험 신청: `app/exam-apply.tsx`, `app/exam-apply2.tsx`
- 서류 업로드: `app/docs-upload.tsx`
- 위촉: `app/appointment.tsx`
- 알림/공지: `app/notifications.tsx`, `app/notice.tsx`

### 웹 관리자 (`web/src/app/*`)

- 인증: `web/src/app/auth/page.tsx`
- 대시보드: `web/src/app/dashboard/page.tsx`
- FC 프로필 상세: `web/src/app/dashboard/profile/[id]/page.tsx`
- 서류 관리: `web/src/app/dashboard/docs/page.tsx`
- 시험 일정/신청자: `web/src/app/dashboard/exam/schedule/page.tsx`, `web/src/app/dashboard/exam/applicants/page.tsx`
- 공지 관리: `web/src/app/dashboard/notifications/page.tsx`
- 관리자 API 라우트: `web/src/app/api/admin/*`

### Supabase Edge Functions (`supabase/functions/*`)

- 인증: `request-signup-otp`, `verify-signup-otp`, `set-password`, `login-with-password`, `reset-password`
- 관리자 액션: `admin-action`
- 민감정보 저장: `store-identity`
- 수당/위촉: `fc-consent`, `fc-submit-appointment`
- 알림/리마인더: `fc-notify`, `docs-deadline-reminder`

## 6. 개발 환경 설정

### 요구사항

- Node.js 20+
- npm 10+
- Expo CLI 사용 가능 환경(Android Studio/Xcode 선택)
- Supabase CLI (`supabase`)

### 환경변수

루트 `.env` (모바일/공용 Supabase 클라이언트):

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

웹 `web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:...
```

Edge Function secrets (Supabase 프로젝트):

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## 7. 실행 명령

### 루트 (모바일/공용)

```bash
npm install
npm start
npm run android
npm run ios
npm run lint
npm test
npm run test:coverage
```

### 웹 관리자

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
supabase functions deploy <function-name> --project-ref <project-ref>
supabase secrets list --project-ref <project-ref>
```

## 8. 운영/보안 가드레일

1. 주민번호 평문 저장/로그/클라이언트 전달 금지
2. 관리자 쓰기는 신뢰 경로(API/Edge Function/service-role) 경유
3. 역할 모델(`admin`, `manager`, `fc`) 계약 유지
4. 스키마 변경 시 `supabase/schema.sql` + `supabase/migrations/*.sql` 동시 반영
5. Edge Function 응답 계약(`ok`, `message`) 호환성 유지

## 9. 최근 반영 사항 (2026-02 기준)

- 시험 신청 화면(생명/손해) 필터링/새로고침 UX 정합성 개선
- 모바일 알림센터 장문 리스트 멀티 셀렉트 드래그 UX 안정화
- 소속 라벨 `1팀~8팀` 기준으로 정규화 및 레거시 데이터 보정 경로 추가
- 웹 공지에서 manager 작성 및 본인 글 수정/삭제 허용(소유권 검증 포함)
- 주민번호 조회 경로를 관리자 서비스 경유 패턴으로 확장

## 10. 참고 문서

- 운영 정책/가이드: `AGENTS.md`, `.claude/PROJECT_GUIDE.md`
- 작업 로그: `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- 계약 문서: `contracts/database-schema.md`, `contracts/api-contracts.md`, `contracts/component-contracts.md`
- 아키텍처 결정: `adr/README.md`
- 명령어 가이드: `docs/guides/COMMANDS.md`
