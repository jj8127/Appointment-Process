# Component Contracts

> 이 문서는 재사용 컴포넌트의 "계약"입니다.
> 컴포넌트 수정 시 기존 사용처 호환성을 유지하세요.

---

## 1. Button 컴포넌트

**위치**: `components/Button.tsx`

### Props
```typescript
interface ButtonProps {
  // Content
  children: React.ReactNode;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;

  // Behavior
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;

  // Styling
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;

  // Accessibility
  accessibilityLabel?: string;
  accessibilityHint?: string;
}
```

### 사용 예시
```tsx
// 기본 (primary, md)
<Button onPress={handleSubmit}>제출</Button>

// 전체 너비, 로딩 상태
<Button
  variant="primary"
  size="lg"
  fullWidth
  loading={isSubmitting}
  onPress={handleSubmit}
>
  회원가입 완료
</Button>

// 아웃라인 스타일
<Button variant="outline" size="md">
  취소
</Button>

// 아이콘 포함
<Button
  variant="ghost"
  leftIcon={<Feather name="plus" size={18} />}
>
  추가하기
</Button>
```

### 금지 사항
- Pressable 직접 사용 금지 → Button 사용
- 버튼 스타일 직접 정의 금지 → variant/size 사용

---

## 2. FormInput 컴포넌트

**위치**: `components/FormInput.tsx`

### Props
```typescript
interface FormInputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  hint?: string;
  variant?: 'text' | 'password' | 'search';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
}
```

### 사용 예시
```tsx
// 기본 텍스트 입력
<FormInput
  label="이름"
  placeholder="이름을 입력하세요"
  value={name}
  onChangeText={setName}
/>

// 비밀번호 (토글 버튼 자동)
<FormInput
  label="비밀번호"
  variant="password"
  value={password}
  onChangeText={setPassword}
/>

// 검색 (검색 아이콘 + 클리어 버튼)
<FormInput
  variant="search"
  placeholder="검색어를 입력하세요"
  value={query}
  onChangeText={setQuery}
/>

// 에러 표시
<FormInput
  label="이메일"
  value={email}
  onChangeText={setEmail}
  error="올바른 이메일 형식이 아닙니다"
/>

// 커스텀 아이콘
<FormInput
  label="전화번호"
  leftIcon={<Feather name="phone" size={18} />}
  keyboardType="phone-pad"
/>
```

### 금지 사항
- TextInput 직접 사용 금지 → FormInput 사용
- 입력 필드 스타일 직접 정의 금지

---

## 3. LoadingSkeleton 컴포넌트

**위치**: `components/LoadingSkeleton.tsx`

### 컴포넌트 종류

#### Skeleton (기본)
```typescript
interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}
```

#### CardSkeleton (카드형)
```typescript
interface CardSkeletonProps {
  showHeader?: boolean;
  lines?: number;
  style?: ViewStyle;
}
```

#### ListSkeleton (리스트형)
```typescript
interface ListSkeletonProps {
  count?: number;
  itemHeight?: number;
  style?: ViewStyle;
}
```

#### FormSkeleton (폼형)
```typescript
interface FormSkeletonProps {
  fields?: number;
  style?: ViewStyle;
}
```

### 사용 예시
```tsx
// 카드형 로딩
{isLoading && (
  <>
    <CardSkeleton showHeader lines={4} />
    <CardSkeleton showHeader lines={3} />
  </>
)}

// 리스트형 로딩
{isLoading && <ListSkeleton count={5} itemHeight={80} />}

// 커스텀 스켈레톤
{isLoading && (
  <View style={{ flexDirection: 'row', gap: 8 }}>
    <Skeleton width="48%" height={90} />
    <Skeleton width="48%" height={90} />
  </View>
)}

// 폼 로딩
{isLoading && <FormSkeleton fields={4} />}
```

### 금지 사항
- ActivityIndicator 단독 사용 금지 → Skeleton 사용
- 로딩 시 빈 화면 표시 금지

---

## 4. Theme 토큰

**위치**: `lib/theme.ts`

### COLORS
```typescript
COLORS.primary       // #f36f21 (메인 오렌지)
COLORS.primaryDark   // 어두운 오렌지
COLORS.primaryLight  // 밝은 오렌지
COLORS.primaryPale   // 배경용 연한 오렌지

COLORS.text.primary   // 기본 텍스트
COLORS.text.secondary // 보조 텍스트
COLORS.text.muted     // 흐린 텍스트

COLORS.background.primary   // 흰색 배경
COLORS.background.secondary // 회색 배경

COLORS.border.light  // 연한 테두리
COLORS.border.medium // 중간 테두리

COLORS.success   // 성공 (초록)
COLORS.error     // 에러 (빨강)
COLORS.warning   // 경고 (주황)
COLORS.info      // 정보 (파랑)
```

### TYPOGRAPHY
```typescript
TYPOGRAPHY.fontSize.xs    // 11
TYPOGRAPHY.fontSize.sm    // 13
TYPOGRAPHY.fontSize.base  // 15
TYPOGRAPHY.fontSize.lg    // 18
TYPOGRAPHY.fontSize.xl    // 20
TYPOGRAPHY.fontSize['2xl'] // 24

TYPOGRAPHY.fontWeight.normal    // 400
TYPOGRAPHY.fontWeight.medium    // 500
TYPOGRAPHY.fontWeight.semibold  // 600
TYPOGRAPHY.fontWeight.bold      // 700
TYPOGRAPHY.fontWeight.extrabold // 800
```

### SPACING
```typescript
SPACING.xs   // 4
SPACING.sm   // 8
SPACING.md   // 12
SPACING.base // 16
SPACING.lg   // 20
SPACING.xl   // 24
SPACING['2xl'] // 32
```

### RADIUS
```typescript
RADIUS.sm   // 4
RADIUS.base // 8
RADIUS.md   // 12
RADIUS.lg   // 16
RADIUS.xl   // 20
RADIUS.full // 9999 (원형)
```

### 금지 사항
- 색상 하드코딩 금지 → COLORS 사용
- 크기 하드코딩 금지 → SPACING, TYPOGRAPHY 사용

---

## 5. 변경 이력

| 날짜 | 변경 내용 | 작성자 |
|------|----------|--------|
| 2025-01-10 | 초기 문서 작성 | AI |
