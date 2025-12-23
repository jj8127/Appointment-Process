# Role
Context7에서 
Framework: Next.js 15 (App Router) + TypeScript
UI: Mantine UI v7 (@mantine/core, @mantine/hooks)
Auth: Supabase SSR / (옵션: Better Auth)
Database: Supabase (Postgres)
AI: Vercel AI SDK (for Chat features)
State: TanStack Query v5
Validation: Zod + React Hook Form
Icons: Tabler Icons React확인해서 프로젝트를 진행하는
Next.js 15, Supabase, Mantine, expo, react-native UI 전문가
Sequential Thinking을 사용해서 놓치는 부분 없이 만듬

# Project Overview
- Name:가람 in
- Purpose: 가람 지사 설계사 등록 과정을 최적화
- Target platform(s): android/ios/web
- Primary user:총무,FC

# Architecture
- App type (mobile/web/backend): mobile(Expo React Native)/web(Next.js) + Supabase Edge Functions
- Frameworks: Expo SDK 54, React 19, Expo Router, Next.js 16
- Routing: Expo Router (app/), Next.js App Router (web/)
- State management: React Query, React Hook Form
- Backend services: Supabase (Auth, Edge Functions, Storage)
- Database: Supabase Postgres

# Environments
- Local dev: `npm start` (Expo), `npm run dev` (web)
- Staging:
- Production:

# Key Flows
- Signup: 로그인 화면 → 회원가입 → 기본정보 입력(소속/이름/휴대폰/추천인/이메일/통신사) → 휴대폰 인증(SMS OTP) → 비밀번호 설정 → 로그인 화면 복귀 → 로그인 → home-lite(1:1 메신저/공지 확인 가능) → 위촉 절차 시작 동의(apply-gate) → 주민번호/주소 입력(identity, 체크섬 검증) → full home → 총무가 임시사번 발급 → FC가 수당 동의 입력 → 총무가 수당 동의 확인/승인 → 총무가 필수 서류 리스트 체크 → FC가 서류 업로드 → 총무가 서류 승인 → 모두 승인 완료 → 총무가 위촉 차수 입력 → FC가 위촉 진행 후 완료 날짜 기입 → 총무가 위촉 승인 완료 체크 → 완료
- Login: 휴대폰 번호 + 비밀번호 로그인
- Onboarding: home-lite 진입 후 위촉 절차 잠금 해제
- Identity verification: 주민번호/주소 입력 + 체크섬 검증

# Integrations
- Auth: Supabase
- Messaging/SMS: NCP SENS (SMS OTP)
- Email: TBD
- Analytics: TBD
- Other: Daum Postcode 검색 (@actbase/react-daum-postcode)

# Security & Compliance
- Data collected: 주민번호, 주소, 기본 인적사항, 연락처, 이메일
- Storage/encryption: 주민번호 암호화(AES-GCM) + 해시 저장, 평문 저장 금지
- Deletion policy: 계정 삭제 Edge Function으로 데이터 정리

# Testing
- Unit tests:
- E2E tests: Testsprite (testsprite_tests/)
- Test accounts:

# Release & Review Notes
- App Store notes: 수집 시점 분리(홈 라이트 → 위촉 절차 시작 시 주민번호/주소 입력)
- Known issues:

# deploy
- ios(app store), android(play store), mobile web(vercel[appointmentprocess]), web(vercel[admin_web]) 