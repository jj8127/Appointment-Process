# context.md - 현재 세션 상태

> 새 세션 시작 시 이 파일을 먼저 읽고 컨텍스트를 파악하세요.
> 세션 종료 시 이 파일을 업데이트하세요.

---

## Current Goal (현재 목표)
- 모든 핵심 Phase 완료 ✅
- 로깅 전환 완료 ✅
- SMS 인증 시스템 프로덕션 모드 설정 완료 ✅
- 본부장 권한 UI 개선 완료 (색상 차별화) ✅
- 추가 개선 항목 대기 중 (필요 시 진행)

---

## Done (완료된 작업)

### 현재 세션 (2025-01-12)
**Phase 5: SMS 인증 시스템 및 권한 관리 개선 (완료)**
- [x] 명령어 모음집 마크다운 변환 (`docs/guides/COMMANDS.md`)
- [x] NCP SENS SMS 프로덕션 모드 설정
  - Test mode 비활성화 (`TEST_SMS_MODE=false`)
  - 실제 SMS 발송 테스트 성공 (01051078127)
  - SMS 테스트 가이드 작성 (`docs/guides/SMS_TESTING.md`)
- [x] 비밀번호 재설정 로직 검토 완료
  - FC 계정: 완전 구현 확인 (request-password-reset, reset-password)
  - Admin/Manager 계정: 비밀번호 재설정 기능 없음 확인
- [x] 본부장(Manager) 권한 UI 개선 - 색상 차별화 방식
  - StatusToggle 컴포넌트: `isManagerMode` prop 추가
  - 대시보드: 모든 액션 버튼 회색조 변경 (14개 버튼)
  - 시험 일정 관리: 일정 등록/수정/삭제 버튼 회색조
  - 시험 신청자 관리: useSession 추가
  - 공지사항 작성: 모든 입력 필드 및 버튼 비활성화
  - 채팅: 메시지 입력창 및 전송 버튼 비활성화
  - 읽기 전용 Alert 추가 (모든 관리 페이지)

### 이전 세션 (2025-01-11)
**Phase 2: TypeScript 타입 안정성 (완료)**
- [x] React Query v5 마이그레이션: `onError` → `onSettled`
- [x] 네비게이션/스타일 타입 오류 해결
- [x] 타입 캐스팅/옵셔널 처리 개선
- [x] Supabase Functions 타입 검사 분리 (`supabase/functions/tsconfig.json`)
- [x] 앱 타입 검사 통과 (`npx tsc --noEmit`)
- [x] Functions 타입 검사 통과 (`npx tsc --project supabase/functions/tsconfig.json --noEmit`)
- [x] 웹 타입 검사 통과 (`npx tsc --project web/tsconfig.json --noEmit`)
- [x] ESLint 경고 0건 (`npm run lint`)

**Phase 3: 테스트 인프라 (완료)**
- [x] Jest + ts-jest 설정 (jest.config.js)
- [x] validation.ts 테스트 작성 (45개 테스트, 100% 커버리지)
- [x] logger.ts 테스트 작성 (8개 테스트)
- [x] 테스트 스크립트 추가 (test, test:watch, test:coverage)

**Phase 4: DX 개선 (완료)**
- [x] lib/logger.ts 생성 (환경별 로그 레벨 지원)
- [x] Git hooks 설정 (Husky + lint-staged)
- [x] pre-commit hook: ESLint 자동 실행
- [x] console.log → logger 전환 완료 (157개 파일, 약 150개 console 문)
  - lib/ (6개 파일)
  - hooks/ (3개 파일)
  - components/ (2개 파일)
  - app/ (23개 파일, 약 70개 console 문)
  - web/ (15개 파일, 68개 console 문)
  - supabase/functions/ (3개 파일)

### 이전 세션 (2025-01-10)
- [x] lib/theme.ts 생성 - 통합 테마 시스템 구축
- [x] lib/validation.ts 생성 - 폼 유효성 검사 유틸리티
- [x] components/Button.tsx 생성 - 재사용 버튼 컴포넌트
- [x] components/FormInput.tsx 생성 - 재사용 입력 필드 컴포넌트
- [x] components/LoadingSkeleton.tsx 생성 - 스켈레톤 로딩 컴포넌트
- [x] 16개 화면에 테마 토큰 마이그레이션 완료
- [x] 4개 화면에 Button 컴포넌트 적용 (signup-password, signup-verify, reset-password, apply-gate)
- [x] 3개 화면에 LoadingSkeleton 적용 (notice, index, dashboard)
- [x] 문서 구조 정리 (docs/, adr/, contracts/, .archive/)

### 이전 작업
- Edge Functions 11개 구현 (인증, OTP, 암호화 등)
- FC 위촉 워크플로우 전체 구현
- Admin Web (Next.js) 대시보드 구현

---

## Open Issues / Risks (미해결 이슈)

### TypeScript
- 앱: 0개 (`npx tsc --noEmit`) ✅
- Supabase Functions: 0개 (`npx tsc --project supabase/functions/tsconfig.json --noEmit`) ✅
- Web: 0개 (`npx tsc --project web/tsconfig.json --noEmit`) ✅

### ESLint
- 경고/에러 0건 (`npm run lint`) ✅

### Testing
- validation.ts: 100% 커버리지 (45 테스트) ✅
- logger.ts: 100% 커버리지 (8 테스트) ✅
- 추가 테스트 필요: components, hooks (선택적)

### SMS 인증 시스템
- ✅ NCP SENS 프로덕션 모드 활성화 완료
- ✅ 실제 SMS 발송 테스트 성공
- 비용 모니터링 필요 (NCP 콘솔에서 확인)

### 권한 관리
- ✅ 본부장(Manager) 계정 UI 색상 차별화 완료
- ⚠️ Admin/Manager 계정 비밀번호 재설정 기능 없음
  - 현재: `request-password-reset`가 FC 계정만 처리
  - 필요 시: Admin/Manager용 별도 구현 필요

### 추가 개선 가능 항목 (선택적)
- ✅ console.log → logger 전환 완료
- ✅ 본부장 권한 UI 개선 완료
- Admin/Manager 비밀번호 재설정 기능 구현 (필요 시)
- 추가 컴포넌트 테스트 (Button, FormInput, LoadingSkeleton)
- E2E 테스트 (Testsprite)

### 주의 사항
- Android LayoutAnimation 비활성화됨 (dashboard.tsx에서 crash 방지)
- enableScreens(false) 설정됨 (_layout.tsx)
- SMS 테스트 모드: `TEST_SMS_MODE=false` (프로덕션)

---

## Next Steps (다음 작업 우선순위)

### 완료 단계 ✅
- ✅ Phase 1: 컴포넌트 통일
- ✅ Phase 2: TypeScript 타입 안정성
- ✅ Phase 3: 테스트 인프라
- ✅ Phase 4: DX 개선 (Logger + Git Hooks)
- ✅ Phase 5: SMS 인증 시스템 및 권한 관리 개선

### 선택적 추가 개선
1. **Admin/Manager 비밀번호 재설정 기능 (필요 시)**
   - request-password-reset 함수 확장
   - reset-password 함수 확장
   - 웹 UI 구현

2. **추가 테스트 작성 (필요 시)**
   - components/ 테스트 (Button, FormInput, LoadingSkeleton)
   - hooks/ 테스트 (use-session, use-identity-gate)
   - React Native Testing Library 활용

3. **성능 최적화 (필요 시)**
   - React.memo 적용
   - useMemo/useCallback 최적화
   - 이미지 최적화

4. **문서화 (필요 시)**
   - API 문서 자동 생성
   - Storybook 도입 검토

---

## Key Files (핵심 파일)

### 재사용 컴포넌트 & 유틸리티
- lib/theme.ts - 테마 토큰 (COLORS, TYPOGRAPHY, SPACING, RADIUS)
- lib/validation.ts - 유효성 검사 함수 (100% 테스트 커버리지)
- lib/logger.ts - 로깅 유틸리티 (환경별 로그 레벨)
- components/Button.tsx - 버튼 컴포넌트 (5 variants, 3 sizes)
- components/FormInput.tsx - 입력 필드 컴포넌트 (3 variants)
- components/LoadingSkeleton.tsx - 스켈레톤 컴포넌트
- web/src/components/StatusToggle.tsx - 상태 토글 (본부장 모드 지원)

### 테스트
- lib/__tests__/validation.test.ts - validation.ts 테스트 (45개)
- lib/__tests__/logger.test.ts - logger.ts 테스트 (8개)
- jest.config.js - Jest 설정 (ts-jest preset)
- test-sms.js - SMS OTP 테스트 스크립트

### 개발 도구
- .husky/pre-commit - Git pre-commit hook (lint-staged)
- package.json - lint-staged 설정

### 인증 & 보안
- supabase/functions/request-signup-otp/ - 회원가입 OTP 발송 (NCP SENS)
- supabase/functions/request-password-reset/ - 비밀번호 재설정 코드 발송
- supabase/functions/reset-password/ - 비밀번호 재설정 처리
- supabase/functions/login-with-password/ - 로그인 (FC/Admin/Manager)

### Phase 5 완료 파일 (권한 관리 UI)
- web/src/app/dashboard/page.tsx - 대시보드 (14개 버튼 색상 차별화)
- web/src/app/dashboard/exam/schedule/page.tsx - 시험 일정 관리
- web/src/app/dashboard/exam/applicants/page.tsx - 시험 신청자 관리
- web/src/app/dashboard/notifications/create/page.tsx - 공지사항 작성
- web/src/app/dashboard/chat/page.tsx - 채팅
- web/src/components/StatusToggle.tsx - 상태 토글 컴포넌트

### Phase 1 완료 파일 (컴포넌트 통일)
- app/consent.tsx - 수당 동의 (Button 3개)
- app/identity.tsx - 신원 확인 (Button 2개)
- app/docs-upload.tsx - 서류 업로드 (Button 3개)
- app/admin-notice.tsx - 공지사항 등록 (FormInput 2개, Button 3개)
- app/admin-messenger.tsx - 메신저 (FormInput 1개, RefreshButton)

### 이전 완료 파일
- app/signup-password.tsx, app/signup-verify.tsx
- app/reset-password.tsx, app/apply-gate.tsx
- app/notice.tsx, app/index.tsx, app/dashboard.tsx

---

## How to Test (검증 방법)

```bash
# 린트 검사
npm run lint

# 타입 검사
npx tsc --noEmit

# 개발 서버 실행
npm start

# SMS OTP 테스트
node test-sms.js 01012345678

# 주요 화면 테스트
# 1. 로그인 → 회원가입 플로우
# 2. 신원 확인 (identity.tsx) - Button 확인
# 3. 수당 동의 (consent.tsx) - 외부링크 버튼, DatePicker 버튼
# 4. 서류 업로드 (docs-upload.tsx) - 관리자 검토 버튼
# 5. 공지사항 등록 (admin-notice.tsx) - FormInput, 첨부파일 버튼
# 6. 메신저 (admin-messenger.tsx) - 검색 FormInput

# 본부장 권한 테스트 (웹)
# 1. 본부장 계정으로 로그인
# 2. 대시보드 - 모든 버튼이 회색으로 표시, 클릭 불가 확인
# 3. 시험 일정 관리 - 일정 등록/수정/삭제 버튼 회색 확인
# 4. 공지사항 작성 - 입력 필드 비활성화 확인
# 5. 채팅 - 메시지 전송 불가 확인
```

---

## Component Usage Reference (컴포넌트 사용 예시)

### Button
```tsx
<Button
  variant="primary" // primary | secondary | outline | ghost | danger
  size="lg"         // sm | md | lg
  fullWidth
  loading={isLoading}
  disabled={disabled}
  leftIcon={<Icon />}
  rightIcon={<Icon />}
  onPress={handleSubmit}
>
  제출하기
</Button>
```

### FormInput
```tsx
<FormInput
  label="이름"
  placeholder="이름을 입력하세요"
  value={name}
  onChangeText={setName}
  variant="password" // default | password | select
  leftIcon={<Feather name="user" />}
  error="필수 입력입니다"
/>
```

### LoadingSkeleton
```tsx
// 카드형
<CardSkeleton showHeader lines={4} />

// 리스트형
<ListSkeleton count={5} itemHeight={80} />

// 기본 박스
<Skeleton width="100%" height={60} />
```

---

## Project Documentation Structure

### Core AI Documents (Root)
- `.cursorrules` - AI core rules
- `AI.md` - Detailed development guide
- `context.md` - Current session state (this file)
- `HANDOVER.md` - Handover protocol
- `CLAUDE.md` - Claude Code guide
- `README.md` - Project introduction

### Architecture Docs
- `adr/` - Architecture Decision Records
  - 0001: ADR 도입
  - 0002: 커스텀 인증 시스템
  - 0003: 테마 시스템 및 재사용 컴포넌트 (**업데이트 필요**)
- `contracts/` - API/DB/Component contracts

### Reference Docs
- `docs/deployment/` - Deployment guides
- `docs/guides/` - Korean guides
  - `COMMANDS.md` - 명령어 모음집 (마크다운 버전)
  - `SMS_TESTING.md` - SMS OTP 테스트 가이드
  - `명령어 모음집.txt` - 원본 명령어 모음집 (한글)
- `docs/superclaude/` - SuperClaude related

---

## Statistics (통계)

### Component Migration Progress
- **Button 컴포넌트**: 11개 버튼 적용 완료
- **FormInput 컴포넌트**: 6개 입력 필드 적용 완료
- **LoadingSkeleton**: 3개 화면 적용 완료
- **StatusToggle**: 본부장 모드 지원 추가
- **Theme 토큰**: 16개 화면 마이그레이션 완료
- **코드 제거**: 약 300줄 중복 스타일 제거

### Manager Permission UI (본부장 권한 UI)
- **대시보드**: 14개 버튼 색상 차별화
- **StatusToggle**: 5개 토글 회색조 변경
- **관리 페이지**: 5개 페이지 읽기 전용 모드 적용
- **Alert 추가**: 모든 관리 페이지에 읽기 전용 안내

### Code Quality (현재 상태)
- **TypeScript**: 0 에러 (App ✅ + Functions ✅ + Web ✅)
- **ESLint**: 0 경고/에러 ✅
- **Tests**: 53개 테스트, 2개 파일 100% 커버리지
- **Git Hooks**: pre-commit (lint-staged) 활성화 ✅
- **Logging**: 구조화된 logger 전환 완료 (약 150개 console 문)
- **SMS**: NCP SENS 프로덕션 모드 활성화 ✅

---

## Last Updated
- **Date**: 2025-01-12
- **By**: AI Assistant
- **Session**: Phase 5 완료 (SMS 인증 + 본부장 권한 UI)
- **Status**:
  - 프로젝트 품질 기반 구축 완료
  - 로깅 시스템 통합 완료
  - SMS 프로덕션 모드 활성화
  - 본부장 권한 UI 색상 차별화 완료
- **Next**: 선택적 개선 항목 (Admin/Manager 비밀번호 재설정, 추가 테스트 등)








