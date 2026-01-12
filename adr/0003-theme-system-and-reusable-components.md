# ADR 0003: Theme System and Reusable Components

## Status
Accepted

## Context
프로젝트 초기에는 각 화면에서 스타일을 직접 정의:
- 같은 오렌지 색상이 `#f36f21`, `#ff6600`, `ORANGE` 등으로 파편화
- 버튼 스타일이 화면마다 조금씩 다름 (약 300줄 중복)
- 로딩 상태 표시가 일관되지 않음
- AI가 새 세션에서 기존 스타일을 모르고 다른 스타일 적용

## Decision
통합 테마 시스템과 재사용 컴포넌트를 도입:

### 1. 테마 시스템 (`lib/theme.ts`)
```typescript
export const COLORS = {
  primary: '#f36f21',
  primaryLight: '#fed7aa',
  white: '#ffffff',
  // ...모든 색상 중앙화
};

export const TYPOGRAPHY = {
  fontSize: { xs: 11, sm: 13, base: 15, ... },
  fontWeight: { normal: '400', bold: '700', ... },
};

export const SPACING = { xs: 4, sm: 8, md: 12, base: 16, ... };
export const RADIUS = { sm: 4, base: 8, md: 12, lg: 16, ... };
export const SHADOWS = { sm: {...}, base: {...}, ... };
```

### 2. 재사용 컴포넌트
| 컴포넌트 | 파일 | 용도 | Variants |
|---------|------|------|----------|
| Button | `components/Button.tsx` | 모든 버튼 | primary, secondary, outline, ghost, danger |
| FormInput | `components/FormInput.tsx` | 모든 입력 필드 | default, password, select |
| LoadingSkeleton | `components/LoadingSkeleton.tsx` | 로딩 상태 표시 | Skeleton, CardSkeleton, ListSkeleton, FormSkeleton |
| ScreenHeader | `components/ScreenHeader.tsx` | 화면 헤더 | 제목, 부제목, 새로고침 |

### 3. 마이그레이션 규칙
- 새 코드: 반드시 테마 토큰 사용
- 기존 코드: 점진적 마이그레이션
- 하드코딩된 색상/크기: 발견 시 테마로 교체
- Pressable 직접 사용 금지 → Button 사용
- TextInput 직접 사용 최소화 → FormInput 사용

## Consequences

### Pros
- 일관된 디자인 시스템 확립
- AI가 테마 토큰만 참조하면 스타일 일관성 유지
- 디자인 변경 시 한 곳만 수정 (theme.ts)
- 코드 중복 대폭 감소 (~300줄 절감)
- 접근성 개선 (일관된 touch target size, 색상 대비)

### Cons
- 기존 코드 마이그레이션 시간 필요
- 테마 시스템 학습 필요
- 극도로 커스텀한 스타일은 예외 처리 필요 (ex: 문서 카드 인라인 버튼)
- 일부 화면은 복잡한 레이아웃으로 직접 스타일링 유지 (ex: identity.tsx 주민번호 입력)

## Alternatives Considered

### 1. Tailwind / NativeWind
- Tailwind CSS의 React Native 버전 사용
- **기각 이유**: 러닝커브, 기존 StyleSheet와 혼용 복잡, 번들 크기

### 2. Styled Components
- CSS-in-JS 라이브러리 사용
- **기각 이유**: 번들 크기 증가, React Native 최적화 이슈

### 3. 현상 유지
- 각 화면에서 개별 스타일 관리
- **기각 이유**: 파편화 심화, AI 일관성 유지 불가, 유지보수 어려움

---

## 마이그레이션 현황

### Phase 1: Component Unification (완료 - 2025-01-10)
**테마 시스템**
- [x] lib/theme.ts 생성 (COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS)
- [x] lib/validation.ts 생성 (폼 유효성 검사)
- [x] 16개 화면 테마 토큰 마이그레이션

**재사용 컴포넌트 생성**
- [x] components/Button.tsx (5 variants, 3 sizes)
- [x] components/FormInput.tsx (3 variants)
- [x] components/LoadingSkeleton.tsx (4 types)
- [x] components/ScreenHeader.tsx

**Button 컴포넌트 적용 (총 11개 버튼)**
- [x] app/signup-password.tsx (2개)
- [x] app/signup-verify.tsx (2개)
- [x] app/reset-password.tsx (2개)
- [x] app/apply-gate.tsx (2개)
- [x] app/consent.tsx (3개 - 외부링크, iOS picker 취소/확인)
- [x] app/identity.tsx (2개 - 주소검색, 모달 닫기)
- [x] app/docs-upload.tsx (3개 - 반려/승인, 홈)
- [x] app/admin-notice.tsx (3개 - 사진/파일 첨부, 등록)

**FormInput 컴포넌트 적용 (총 6개 입력)**
- [x] app/signup-password.tsx (1개)
- [x] app/signup-verify.tsx (1개)
- [x] app/reset-password.tsx (2개)
- [x] app/admin-notice.tsx (2개 - 카테고리, 제목)
- [x] app/admin-messenger.tsx (1개 - 검색)

**LoadingSkeleton 적용 (총 3개 화면)**
- [x] app/notice.tsx (CardSkeleton)
- [x] app/index.tsx (Skeleton, 진행 카드 + 관리자 메트릭)
- [x] app/dashboard.tsx (ListSkeleton)

**코드 정리**
- [x] 약 300줄의 중복 스타일 코드 제거
- [x] 사용하지 않는 import 정리
- [x] 일관된 컴포넌트 import 순서

### 미적용 화면 (특수 케이스)
**직접 TextInput 유지가 적합한 경우:**
- identity.tsx: 주민번호 2개 입력 (side-by-side 레이아웃), 주소 (multiline with dynamic height)
- admin-notice.tsx: 본문 (multiline with dynamic height)
- consent.tsx: 임시사번 입력은 FormInput 사용, 날짜는 DatePicker

**직접 Pressable 유지가 적합한 경우:**
- docs-upload.tsx: 문서 카드 내 인라인 버튼 (열기/업로드/삭제 - 특수 스타일링)
- admin-notice.tsx: 이미지/파일 제거 X 버튼 (작은 아이콘 버튼)
- admin-messenger.tsx: 채팅 목록 아이템 (커스텀 레이아웃)

### Phase 2: TypeScript Type Safety (완료 - 2025-01-11)
- [x] React Query v5 마이그레이션 (`onError` → `onSettled` 전환)
- [x] 네비게이션/스타일 타입 오류 해결
- [x] 타입 캐스팅/옵셔널 처리 개선
- [x] Supabase Functions 타입 검사 분리 (`supabase/functions/tsconfig.json` 생성)
- [x] 앱 타입 검사 통과 (`npx tsc --noEmit`: 0개 오류)
- [x] Functions 타입 검사 통과 (`npx tsc --project supabase/functions/tsconfig.json --noEmit`: 0개 오류)
- [x] 웹 타입 검사 통과 (`npx tsc --project web/tsconfig.json --noEmit`: 0개 오류)
- [x] ESLint 경고 0건 (`npm run lint`)

### Phase 3: Testing (진행 중 - 2025-01-11)
- [ ] Jest + React Native Testing Library 설정
- [ ] lib/validation.ts 테스트
- [ ] 컴포넌트 테스트 (Button, FormInput, LoadingSkeleton)
- [ ] 핵심 hooks 테스트 (use-session, use-identity-gate)

### Phase 4: DX Improvements (진행 중 - 2025-01-11)
- [ ] lib/logger.ts 생성 (환경별 로그 레벨 지원)
- [ ] console.log → logger 전환 (89개)
- [ ] Git hooks (Husky + lint-staged)

---

## Implementation Notes

### Button 사용 예시
```tsx
// Primary button (기본)
<Button variant="primary" size="lg" fullWidth onPress={handleSubmit}>
  제출하기
</Button>

// Outline button with icon
<Button
  variant="outline"
  leftIcon={<Feather name="search" size={20} />}
  onPress={handleSearch}
>
  검색
</Button>

// Loading state
<Button variant="primary" loading={isLoading} disabled={isLoading}>
  처리 중...
</Button>
```

### FormInput 사용 예시
```tsx
// Basic text input
<FormInput
  label="이름"
  placeholder="이름을 입력하세요"
  value={name}
  onChangeText={setName}
  error={errors.name}
/>

// Password input
<FormInput
  label="비밀번호"
  variant="password"
  value={password}
  onChangeText={setPassword}
/>

// Search input
<FormInput
  placeholder="검색"
  leftIcon={<Feather name="search" size={16} />}
  value={keyword}
  onChangeText={setKeyword}
/>
```

### 특수 케이스 처리
```tsx
// 복잡한 레이아웃 → TextInput 직접 사용
<View style={styles.residentRow}>
  <TextInput style={styles.residentInput} maxLength={6} />
  <Text>-</Text>
  <TextInput style={styles.residentInput} maxLength={7} secureTextEntry />
</View>

// 작은 아이콘 버튼 → Pressable 직접 사용
<Pressable style={styles.removeBtn} onPress={onRemove}>
  <Feather name="x" size={12} color="#fff" />
</Pressable>
```

---

## Metrics

### Before (마이그레이션 전)
- 중복 버튼 스타일: ~300줄
- 색상 정의: 20+ 곳에 분산
- 일관성: 낮음 (화면마다 다른 스타일)

### After (Phase 1 완료 후)
- 중복 제거: ~300줄 절감
- 색상 정의: 1곳 (lib/theme.ts)
- 일관성: 높음 (Button 11개, FormInput 6개 통일)
- 재사용 컴포넌트: 4개 (Button, FormInput, LoadingSkeleton, ScreenHeader)

---

## Last Updated
- **Date**: 2025-01-11
- **Status**: Phase 1-2 완료, Phase 3-4 진행 중
- **TypeScript Coverage**: 100% (App + Functions + Web 모두 타입 안전)
- **ESLint**: 0 warnings/errors
