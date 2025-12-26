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

# Test Plan
## 범위
- 플랫폼: Mobile(Expo iOS/Android), Web(Next.js)
- 역할: 총무(Admin), FC
- 핵심 흐름: 회원가입 → 인증 → home-lite → 위촉 절차 → 완료

## 테스트 환경/데이터
- 테스트 계정: 총무 1, FC 2(정상/반려 케이스)
- 테스트 문서: 이미지/문서(PDF), 대용량(상한 근접), 확장자 제한 테스트용
- 알림: 푸시 토큰 등록 가능한 실제 디바이스 1대 이상

## Mobile 전용
- 회원가입 로직 정상 동작
- 비밀번호 초기화 후 로그인 정상 동작
- home-lite에서 1:1 문의/공지 정상 동작 및 다른 기능 진입 차단 확인
- 주민번호/주소 입력 후 full home 이동 확인
- 푸시 권한 허용/거부 각각의 동작 및 안내 메시지 확인
- 백그라운드/포그라운드 전환 후 세션 유지/재인증 확인

## 공통(Web + Mobile)
### 위촉 로직(엔드 투 엔드)
1. 총무 임시사번 발급 → FC에 반영 확인
2. FC 날짜 입력 → 총무 승인/미승인 처리 확인
3. 수당 동의 승인 후 시험 신청 가능 여부 확인
4. 필수 서류 추가/수정/삭제 및 기타 서류 포함 여부 확인
5. FC 파일 업로드/삭제 정상 동작(권한/용량/형식 포함)
6. 총무 개별 파일 승인/미승인 처리 확인
7. 모든 서류 승인 시 위촉 단계 전환 확인
8. 총무 위촉 차수 입력 정상 동작
9. FC 위촉 날짜 입력 정상 동작
10. 총무 위촉 날짜 승인/미승인 처리 확인
11. 1:1 문의 기능(알림 포함, 이미지/파일 전송 포함) 정상 동작
12. 공지 기능(알림, 이미지/파일 전송 포함) 정상 동작
13. 반려 사유 입력/표시가 각 단계 및 알림에 정확히 반영되는지 확인

### 권한/접근 제어
- 총무/FC별 메뉴 및 라우트 접근 제한 확인
- home-lite에서 위촉 절차 시작 전 민감 정보 접근 차단 확인
- 로그아웃 후 보호 라우트 접근 차단 확인

### 데이터/보안
- 주민번호 암호화 저장 및 평문 저장 금지 확인
- 주민번호/주소 입력 시 체크섬/형식 검증 확인
- 계정 삭제 Edge Function 실행 시 데이터 정리 확인

### 알림/메시징
- 1:1 메시지 읽음 처리/미읽음 카운트 갱신 확인
- 공지/알림 수신 및 앱 내 배지 카운트 업데이트 확인

### 파일/스토리지
- 동일 파일 재업로드 시 중복 처리 정책 확인
- 업로드 실패/네트워크 끊김 시 재시도 동작 확인

### 회귀/호환성
- iOS/Android 주요 OS 버전에서 UI 깨짐/크래시 여부
- Web 주요 브라우저(Chrome/Safari/Edge) 동작 확인
