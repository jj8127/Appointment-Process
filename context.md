# context.md - 현재 세션 상태

> 새 세션 시작 시 이 파일을 먼저 읽고 컨텍스트를 파악하세요.
> 세션 종료 시 이 파일을 업데이트하세요.

---

## Current Goal (현재 목표)
- 모든 핵심 Phase 완료 ✅
- 로깅 전환 완료 ✅
- SMS 인증 시스템 프로덕션 모드 설정 완료 ✅
- 본부장 권한 UI 개선 완료 (색상 차별화) ✅
- 모바일 게시판 UI/관리자 게시판 UI (UI only) 구현 ✅
- 게시판 백엔드 설계/Edge Functions 초안 완료 ✅
- 추가 개선 항목 대기 중 (필요 시 진행)

---

## Done (완료된 작업)

### 현재 세션 (2026-01-20)
**설정 화면 정리**
- [x] 앱 설정의 디버깅용 “알림 채널” 섹션 제거 (채널 상태 확인 UI/로직 삭제)

### 현재 세션 (2026-01-16)
**UI 디자인 업그레이드**
- [x] lib/theme.ts 확장: ANIMATION.spring, ALERT_VARIANTS, TOAST 설정 추가
- [x] AppAlertProvider 개선: 브랜드 컬러 적용, 아이콘 다양화(info/success/warning/error), Reanimated 애니메이션
- [x] Toast 컴포넌트 신규 생성: 스와이프 dismiss, 프로그레스 바, 4가지 variant
- [x] BoardCard 컴포넌트 생성: 호버/프레스 애니메이션, Moti 진입 애니메이션, 고정글 표시
- [x] EmptyState 컴포넌트 생성: 범용 빈 상태 UI + 프리셋(게시글/댓글/알림/검색/에러)
- [x] LoadingSkeleton 개선: Shimmer 그라데이션 효과, BoardSkeleton/TextSkeleton 추가
- [x] _layout.tsx에 ToastProvider 추가

**Phase 8 확장: 게시판 UI 표시 정리**
- [x] 관리자 게시판 댓글 수정 표시를 날짜 + '수정됨'으로 변경 (사용자 게시판과 일치)
- [x] 게시글 상세 '반응 남기기' 버튼을 아이콘 전용으로 변경 (앱/관리자)
- [x] 웹 관리자 게시판 빌드 오류 해결: `web/src/lib/board-api.ts` 추가
- [x] 웹 게시판 런타임 에러(TDZ) 해결: categories useQuery를 useEffect보다 상단으로 이동
- [x] 웹 게시판 런타임 에러(TDZ) 해결: editDetailData useQuery를 useEffect보다 상단으로 이동
- [x] 게시판 Edge Functions CORS 동적 허용(Origin 기반) 적용: `_shared/board.ts` + board-* 함수 전반 수정
- [x] 웹 게시판 기능 확장: 이미지 미리보기, 댓글/답글(깊이 2), 댓글 좋아요, 댓글 수정/삭제, 반응 버튼 아이콘화
- [x] 반응 선택 상태 표시 + 변경/취소 가능하도록 처리 (앱/관리자/웹)
- [x] 규칙 문서 업데이트: `.cursorrules`, `AI.md`

### 현재 세션 (2026-01-15)
**Phase 8 확장: 게시판 UX 개선 + 앱 공통 모달**
- [x] 댓글 스레드 UI 개선 (앱/관리자)
  - 답글/답글의 답글 들여쓰기 + 깊이별 카드 스타일 구분
  - 답글 접기/펼치기 토글 (기본 접힘)
- [x] 댓글 답글 깊이 2 허용 로직 추가 (Edge Function 업데이트 필요)
- [x] 관리자 게시판 이미지 미리보기 크기 사용자와 동일화
- [x] 글쓰기 FAB가 하단 네비 숨김/표시와 함께 이동
- [x] 관리자 글쓰기 기존 첨부파일 삭제 기능 추가 (서버 삭제 포함)
  - 새 Edge Function `board-attachment-delete` 추가/배포
  - `lib/board-api.ts`에 `deleteBoardAttachments` 추가
- [x] 앱 전체 Alert → 커스텀 모달 통일 (`components/AppAlertProvider.tsx`)
- [x] 회원가입/기본정보: 통신사/이메일 선택 박스 전체 터치로 열기
- [x] 기본정보 이메일 도메인 모달을 통신사 모달과 동일 스타일로 통일
- [x] 관리자 글쓰기 화면: 안내 박스/미리보기 UI 제거

### 현재 세션 (2026-01-13)
**Phase 6: 게시판 UI (모바일/관리자/웹) - UI 단계**
- [x] 모바일 게시판 UI 추가 (`app/board.tsx`)
  - 게시글 목록/검색, 반응 버튼, 첨부 미리보기
  - 게시글 상세 모달: 드래그 닫기/애니메이션, 댓글 입력 하단 고정
  - 스크롤 시 하단 네비 숨김/복귀
- [x] 관리자 게시판 관리 UI 추가 (`app/admin-board-manage.tsx`)
  - 사용자 화면과 동일한 카드/상세 UI
  - 글쓰기 FAB (스크롤 시 축소/확장 애니메이션)
  - 수정/삭제 액션 시트, 읽기 전용 모드 대응
- [x] 관리자 게시글 작성 UI 추가 (`app/admin-board.tsx`) - 폼 + 첨부/삭제
- [x] 하단 탭에 게시판 진입 추가 (`app/index.tsx`)
- [x] GestureHandlerRootView 적용 (`app/_layout.tsx`)
- [x] 웹 관리자 게시판 UI 추가 (`web/src/app/dashboard/board/page.tsx`)

**Phase 7: 게시판 백엔드 설계 (초안)**
- [x] 게시판 요구사항 정리 문서 작성 (`docs/guides/BOARD_REQUIREMENTS.md`)
- [x] 게시판 API 계약 추가 (`contracts/api-contracts.md`)
- [x] 스키마/뷰/RLS/스토리지 초안 추가 (`supabase/schema.sql`)
  - 게시판 테이블 6개 + 집계 뷰 2개(+with_stats 뷰)
  - 서비스 롤 전용 RLS 적용
  - 스토리지 버킷 `board-attachments` 추가
- [x] 게시판 Edge Functions 초안 추가 (`supabase/functions/board-*`)
  - 공통 유틸: `_shared/board.ts`
- [x] 게시판 Edge Functions 배포 완료 (Supabase Functions)

**Phase 8: 게시판 데이터 연동 (앱)**
- [x] 모바일 게시판 API 연동 (`app/board.tsx`)
- [x] 관리자 게시판 관리 API 연동 (`app/admin-board-manage.tsx`)
- [x] 관리자 글쓰기 API 연동 + 카테고리 선택 UI (`app/admin-board.tsx`)
- [x] board-list/board-detail 응답에 `isMine` 추가 및 재배포
- [x] 관리자 글쓰기 첨부 업로드 연동 (`app/admin-board.tsx`)
- [x] 관리자 게시글 수정 UI 연결 (`app/admin-board.tsx`, `app/admin-board-manage.tsx`)
- [x] 웹 관리자 게시판 데이터 연동 (`web/src/app/dashboard/board/page.tsx`)
- [x] 웹 게시판 글쓰기 첨부 업로드 UI + 업로드 연동 (`web/src/app/dashboard/board/page.tsx`)

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
- App Review 대응: `verify-signup-otp`/`reset-password`에 `SMS_BYPASS_CODE=123456` 우회 로직 추가 (리뷰 후 비활성화 권장)

### 권한 관리
- ✅ 본부장(Manager) 계정 UI 색상 차별화 완료
- ⚠️ Admin/Manager 계정 비밀번호 재설정 기능 없음
  - 현재: `request-password-reset`가 FC 계정만 처리
  - 필요 시: Admin/Manager용 별도 구현 필요

### 게시판 (완료)
- Edge Functions 배포 완료 (board-* 17개 함수)
- 스키마 반영 완료 (supabase/schema.sql 적용)
- 앱 연동 완료: 목록/상세/댓글/반응/댓글 좋아요
- 첨부파일 업로드/다운로드 API 연결 완료 (글쓰기/상세)
- 댓글 답글 깊이 2 허용 로직 적용됨 (board-comment-create 배포 완료)
- 기존 첨부 삭제 API 추가됨 (`board-attachment-delete` 배포 완료)
- 웹 관리자 게시판 데이터 연동 완료

### 코드 품질 개선 (2026-01-16)
- [x] Web ESLint 에러 대폭 감소 (any 타입 → 명시적 타입)
- [x] App ESLint 경고 해결 (미사용 변수/import 제거)
- [x] board-attachment-delete 에러 처리 추가
- [x] ADR 0003 문서 최신화 (Phase 3-8 완료)

### Open Issues (미해결)
- 웹 ESLint: 일부 경고 남음 (setState in effect, exhaustive-deps)
- 웹 게시판 첨부 삭제 UI: 기존 첨부파일 삭제 버튼 미구현

### 추가 개선 가능 항목 (선택적)
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
- ✅ Phase 3: 테스트 인프라 (Jest + 53개 테스트)
- ✅ Phase 4: DX 개선 (Logger + Git Hooks)
- ✅ Phase 5: SMS 인증 시스템 및 권한 관리 개선
- ✅ Phase 6: 게시판 UI (모바일/관리자/웹)
- ✅ Phase 7: 게시판 백엔드 (스키마/Edge Functions 17개)
- ✅ Phase 8: 게시판 데이터 연동 (앱/웹)

### 선택적 추가 개선
1. **Admin/Manager 비밀번호 재설정 기능 (필요 시)**
   - request-password-reset 함수 확장
   - reset-password 함수 확장
   - 웹 UI 구현

2. **추가 테스트 작성 (필요 시)**
   - components/ 테스트 (Button, FormInput, LoadingSkeleton)
   - hooks/ 테스트 (use-session, use-identity-gate)
   - React Native Testing Library 활용

4. **성능 최적화 (필요 시)**
   - React.memo 적용
   - useMemo/useCallback 최적화
   - 이미지 최적화

5. **문서화 (필요 시)**
   - API 문서 자동 생성
   - Storybook 도입 검토

---

## Key Files (핵심 파일)

### 재사용 컴포넌트 & 유틸리티
- lib/theme.ts - 테마 토큰 (COLORS, TYPOGRAPHY, SPACING, RADIUS, ANIMATION, ALERT_VARIANTS, TOAST)
- lib/validation.ts - 유효성 검사 함수 (100% 테스트 커버리지)
- lib/logger.ts - 로깅 유틸리티 (환경별 로그 레벨)
- components/Button.tsx - 버튼 컴포넌트 (5 variants, 3 sizes)
- components/FormInput.tsx - 입력 필드 컴포넌트 (3 variants)
- components/LoadingSkeleton.tsx - 스켈레톤 컴포넌트 (Shimmer 효과, Board/Text 스켈레톤)
- components/AppAlertProvider.tsx - 앱 전역 알림 모달 (4 variants, Reanimated)
- components/Toast.tsx - 토스트 알림 (스와이프 dismiss, 프로그레스 바)
- components/BoardCard.tsx - 게시판 카드 (프레스 애니메이션, 고정글)
- components/EmptyState.tsx - 빈 상태 UI (5개 프리셋)
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

### 게시판 UI (모바일/관리자/웹)
- app/board.tsx - FC 게시판 (목록/검색/상세 모달, 제스처/애니메이션)
- app/admin-board-manage.tsx - 관리자 게시판 관리 (수정/삭제 UI, FAB)
- app/admin-board.tsx - 관리자 게시글 작성 (폼 + 첨부/삭제)
- app/index.tsx - 하단 탭 게시판 진입
- app/_layout.tsx - GestureHandlerRootView 적용
- components/AppAlertProvider.tsx - 전역 Alert 커스텀 모달
- web/src/app/dashboard/board/page.tsx - 웹 관리자 게시판 UI

### 게시판 백엔드 (Edge Functions + Schema)
- supabase/schema.sql - 게시판 테이블/뷰/RLS/스토리지
- supabase/functions/_shared/board.ts - 게시판 공통 유틸
- supabase/functions/board-* - 게시판 Edge Functions (목록/상세/CRUD/반응/댓글/첨부)
- supabase/functions/board-attachment-delete - 첨부 삭제 (신규)
- contracts/api-contracts.md - 게시판 API 계약
- docs/guides/BOARD_REQUIREMENTS.md - 게시판 요구사항 문서

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

# 게시판 UI 테스트 (모바일)
# 1. FC 계정 로그인 → 하단 탭 '게시판' 진입
# 2. 게시글 상세 오픈 → 드래그로 닫기 애니메이션 확인
# 3. 첨부/반응/댓글 UI 확인, 댓글 입력 하단 고정 확인

# 게시판 관리 UI 테스트 (관리자)
# 1. 관리자 계정 로그인 → 하단 탭 '게시판' 진입
# 2. 글쓰기 FAB 스크롤 시 축소/확장 확인
# 3. 상세 화면 더보기(⋮) → 수정/삭제 시트 표시 확인
# 4. 글쓰기 화면에서 기존 첨부 삭제 동작 확인
# 5. 댓글 답글 접기/펼치기, 답글 깊이 2 위치 확인

# 게시판 UI 테스트 (웹)
# 1. 관리자/본부장 계정 로그인 → /dashboard/board
# 2. 본부장 계정은 읽기 전용 알림 표시, 작성 버튼 숨김 확인

# 게시판 백엔드 테스트 (배포 후)
# 1. Supabase 스키마 반영 (schema.sql 적용)
# 2. board-* Edge Functions 배포
# 3. board-list/board-detail 호출 응답 확인
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

### Board UI (게시판 UI)
- **모바일**: 게시판 목록/상세/제스처/첨부 UI 구현
- **관리자**: 게시판 관리/글쓰기 UI (FAB + 액션 시트, 첨부 삭제)
- **웹**: 관리자 게시판 페이지 UI 추가

### Board Backend (게시판 백엔드)
- **Schema**: 게시판 테이블/뷰/RLS/스토리지 초안 추가
- **Edge Functions**: board-* 17개 함수 (첨부 삭제 추가)
- **Contracts**: API 계약/요구사항 문서 업데이트

### Code Quality (현재 상태)
- **TypeScript**: 0 에러 (App ✅ + Functions ✅ + Web ✅)
- **ESLint**: 0 경고/에러 ✅
- **Tests**: 53개 테스트, 2개 파일 100% 커버리지
- **Git Hooks**: pre-commit (lint-staged) 활성화 ✅
- **Logging**: 구조화된 logger 전환 완료 (약 150개 console 문)
- **SMS**: NCP SENS 프로덕션 모드 활성화 ✅

---

## Last Updated
- **Date**: 2026-01-20
- **By**: AI Assistant
- **Session**: 설정 화면 정리
- **Status**:
  - 디버깅용 “알림 채널” 섹션 제거 완료
