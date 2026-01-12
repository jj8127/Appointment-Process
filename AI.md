# AI.md - FC Onboarding App 상세 개발 가이드

> 이 문서는 AI가 코드를 작성할 때 참조해야 하는 상세 규칙입니다.
> `.cursorrules`는 핵심만, 이 파일은 상세 내용을 담습니다.

---

## 1. Project North Star

### 1.1 프로젝트 목표
- **무엇인가**: 보험 설계사(FC) 위촉 프로세스를 관리하는 크로스플랫폼 앱
- **누가 쓰나**: FC(신규 설계사), Admin/Manager(관리자)
- **핵심 플로우**: 가입 → 신원확인 → 임시사번 → 동의 → 시험 → 서류 → 위촉완료

### 1.2 비범위 (Out of Scope)
- 결제/금융 거래 기능
- 실시간 화상 통화
- 타사 보험 연동

---

## 2. Architecture Rules

### 2.1 프로젝트 구조
```
fc-onboarding-app/
├── app/                    # Expo Router 화면 (Mobile)
├── web/src/app/            # Next.js App Router (Admin Web)
├── components/             # 재사용 컴포넌트
├── hooks/                  # 커스텀 훅
├── lib/                    # 유틸리티, 설정
├── types/                  # TypeScript 타입 정의
├── supabase/
│   ├── functions/          # Edge Functions
│   └── schema.sql          # DB 스키마
├── contracts/              # API/스키마 계약 문서
└── adr/                    # 아키텍처 결정 기록
```

### 2.2 의존성 규칙
```
[UI Layer] app/, web/src/app/
    ↓ (import)
[Components] components/
    ↓
[Hooks] hooks/
    ↓
[Libraries] lib/
    ↓
[Types] types/

※ 역방향 import 금지
※ components/에서 app/ import 금지
※ lib/에서 hooks/ import 금지
```

### 2.3 기술 스택 (변경 금지)
| 영역 | 기술 | 버전 |
|------|------|------|
| Mobile | Expo SDK | 54 |
| Mobile | React Native | 0.81.5 |
| Web | Next.js | 16 |
| UI (Web) | Mantine | v8 |
| 상태관리 | TanStack React Query | v5 |
| 폼 | React Hook Form + Zod | - |
| DB | Supabase Postgres | - |
| 인증 | Custom (Edge Functions) | - |

---

## 3. Code Style Rules

### 3.1 네이밍 컨벤션
```typescript
// DB 컬럼 (snake_case)
fc_profiles.temp_id
fc_profiles.created_at

// TypeScript (camelCase)
interface FcProfile {
  tempId: string;
  createdAt: string;
}

// 컴포넌트 (PascalCase)
Button.tsx, FormInput.tsx, LoadingSkeleton.tsx

// 훅 (use-kebab-case)
use-session.tsx, use-identity-gate.ts

// 유틸리티 (kebab-case)
safe-storage.ts, validation.ts
```

### 3.2 테마 시스템
```typescript
// 반드시 테마 토큰 사용
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

// Good
backgroundColor: COLORS.primary
fontSize: TYPOGRAPHY.fontSize.lg
padding: SPACING.md
borderRadius: RADIUS.lg

// Bad - 하드코딩 금지
backgroundColor: '#f36f21'
fontSize: 18
padding: 12
```

### 3.3 컴포넌트 사용
```typescript
// 버튼 - Button 컴포넌트 사용
import { Button } from '@/components/Button';
<Button variant="primary" size="lg" onPress={handleSubmit}>
  제출
</Button>

// 입력 필드 - FormInput 컴포넌트 사용
import { FormInput } from '@/components/FormInput';
<FormInput
  label="이름"
  value={name}
  onChangeText={setName}
/>

// 로딩 상태 - LoadingSkeleton 사용
import { CardSkeleton, ListSkeleton } from '@/components/LoadingSkeleton';
{isLoading && <CardSkeleton lines={3} />}
```

### 3.4 데이터 페칭 패턴
```typescript
// React Query 사용
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['fc-profiles', id],
  queryFn: () => fetchProfile(id),
});

// Mutation
const mutation = useMutation({
  mutationFn: updateProfile,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
  },
  onError: (error) => {
    Alert.alert('오류', error.message);
  },
});
```

### 3.5 에러 처리
```typescript
// Edge Function 호출
try {
  const { data, error } = await supabase.functions.invoke('function-name', {
    body: { ... },
  });
  if (error) throw error;
  if (!data?.ok) {
    Alert.alert('알림', data?.message ?? '요청에 실패했습니다.');
    return;
  }
  // 성공 처리
} catch (err: any) {
  Alert.alert('오류', err?.message ?? '처리 중 문제가 발생했습니다.');
}
```

---

## 4. Forbidden Changes (변경 금지 목록)

### 4.1 절대 변경 금지
1. **인증 시스템**: Supabase Auth → 커스텀 인증 (이미 커스텀으로 구현됨)
2. **상태관리**: React Query 유지, Redux/Zustand 도입 금지
3. **폴더 구조**: ADR 없이 폴더/파일 재구성 금지
4. **보안**: 주민번호 암호화 로직 변경 금지

### 4.2 경고 필요
1. **DB 스키마 변경**: ADR 필수, 마이그레이션 스크립트 포함
2. **API 계약 변경**: contracts/ 문서 업데이트 필수
3. **새 의존성 추가**: 사유 명시 필요

---

## 5. Change Process (변경 절차)

### 5.1 일반 기능 추가
1. 기존 패턴 확인
2. 유사 코드 참조
3. 구현 → 테스트

### 5.2 구조 변경 (ADR 필수)
1. **변경 제안서 작성**
   - Context: 현재 상황
   - Decision: 결정 내용
   - Consequences: 장단점
   - Alternatives: 대안
2. **승인 후 구현**
3. **adr/ 폴더에 ADR 저장**

### 5.3 DB 스키마 변경
1. ADR 작성
2. supabase/schema.sql 수정
3. 마이그레이션 스크립트 작성
4. types/*.ts 업데이트

---

## 6. 재사용 컴포넌트 목록

### 6.1 현재 사용 가능한 컴포넌트
| 컴포넌트 | 파일 | 용도 |
|---------|------|------|
| Button | components/Button.tsx | 모든 버튼 |
| FormInput | components/FormInput.tsx | 텍스트 입력 필드 |
| LoadingSkeleton | components/LoadingSkeleton.tsx | 로딩 상태 표시 |
| ScreenHeader | components/ScreenHeader.tsx | 화면 헤더 |
| KeyboardAwareWrapper | components/KeyboardAwareWrapper.tsx | 키보드 대응 |
| RefreshButton | components/RefreshButton.tsx | 새로고침 버튼 |

### 6.2 새 컴포넌트 생성 기준
- 3회 이상 반복되는 UI 패턴
- 기존 컴포넌트로 해결 불가능할 때만
- props 설계 시 기존 컴포넌트 패턴 참조

---

## 7. 세션 핸드오버 프로토콜

### 7.1 세션 시작 시
```text
[context.md]의 내용을 읽고 현재 상태 파악 후 작업 시작
```

### 7.2 세션 종료 시
```text
1. 이번 세션 변경 요약 (핵심 5줄)
2. 변경 파일 목록
3. AI.md/contracts에 반영할 새 규칙
4. ADR 필요 시 초안
5. 남은 TODO
6. 검증 절차
7. 롤백 계획
```

---

## 8. 자주 하는 실수 방지

### 8.1 스타일 관련
```typescript
// Bad - 하드코딩
style={{ backgroundColor: '#f36f21', padding: 16 }}

// Good - 테마 사용
style={{ backgroundColor: COLORS.primary, padding: SPACING.base }}
```

### 8.2 버튼 관련
```typescript
// Bad - Pressable 직접 사용
<Pressable onPress={handleSubmit}>
  <Text>제출</Text>
</Pressable>

// Good - Button 컴포넌트
<Button onPress={handleSubmit} variant="primary">
  제출
</Button>
```

### 8.3 로딩 상태
```typescript
// Bad - ActivityIndicator 직접 사용
{isLoading && <ActivityIndicator />}

// Good - LoadingSkeleton 사용
{isLoading && <CardSkeleton lines={3} />}
```

### 8.4 인증 관련
```typescript
// Bad - Supabase Auth 직접 사용
await supabase.auth.signIn(...)

// Good - 커스텀 Edge Function 사용
await supabase.functions.invoke('login-with-password', {
  body: { phone, password }
})
```

---

## 9. 문서 위치 가이드

| 문서 | 위치 | 내용 |
|------|------|------|
| 핵심 규칙 | .cursorrules | AI 필수 준수 규칙 (짧게) |
| 상세 규칙 | AI.md | 개발 상세 가이드 (이 파일) |
| 현재 상태 | context.md | 세션 간 컨텍스트 전달 |
| 스키마 계약 | contracts/ | DB/API 스키마 정의 |
| 결정 기록 | adr/ | 아키텍처 결정 히스토리 |
| 프로젝트 설명 | CLAUDE.md | 프로젝트 개요 (Claude Code용) |
