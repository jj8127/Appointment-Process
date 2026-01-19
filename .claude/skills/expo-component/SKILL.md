---
name: expo-component
description: Expo/React Native 컴포넌트 작성 가이드. 모바일 앱 UI 컴포넌트 생성, 수정, 스타일링 관련 질문 시 사용.
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Expo/React Native 컴포넌트 가이드

이 프로젝트의 모바일 앱 컴포넌트 패턴을 따릅니다.

## 프로젝트 구조

```
app/                    # Expo Router 파일 기반 라우팅
├── _layout.tsx         # 루트 레이아웃
├── index.tsx           # 홈 화면
├── (tabs)/             # 탭 네비게이션 그룹
components/             # 재사용 컴포넌트
hooks/                  # 커스텀 훅
lib/                    # 유틸리티, API 클라이언트
```

## 디자인 시스템

### 컬러 팔레트

```typescript
const HANWHA_ORANGE = '#f36f21';  // 주 브랜드 컬러
const CHARCOAL = '#111827';       // 텍스트
const TEXT_MUTED = '#6b7280';     // 보조 텍스트
const BORDER = '#e5e7eb';         // 테두리
```

### 공통 스타일 패턴

```typescript
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};
```

## 컴포넌트 패턴

### 1. 화면 컴포넌트 기본 구조

```typescript
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/hooks/use-session';

export default function ScreenName() {
  const { role, displayName, residentId } = useSession();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={[styles.header, { paddingTop: 8 + insets.top }]}>
        {/* 헤더 내용 */}
      </View>
      {/* 본문 */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
});
```

### 2. 애니메이션 (Reanimated)

```typescript
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';

// 공유 값 정의
const translateY = useSharedValue(0);

// 애니메이션 스타일
const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ translateY: translateY.value }],
}));

// 애니메이션 트리거
translateY.value = withTiming(100, { duration: 300 });
translateY.value = withSpring(0, { damping: 15, stiffness: 100 });
```

### 3. 데이터 페칭 (TanStack Query)

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// 조회
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ['resource-name', id],
  queryFn: () => fetchResource(id),
  enabled: !!id,
});

// 변경
const queryClient = useQueryClient();
const mutation = useMutation({
  mutationFn: async (payload) => updateResource(payload),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['resource-name'] });
  },
  onError: (error) => {
    Alert.alert('오류', '처리에 실패했습니다.');
  },
});
```

### 4. 폼 처리 (React Hook Form + Zod)

```typescript
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, '이름을 입력해주세요'),
  phone: z.string().regex(/^01[0-9]{8,9}$/, '올바른 전화번호를 입력해주세요'),
});

const { control, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(schema),
  defaultValues: { name: '', phone: '' },
});
```

## 주요 컴포넌트

| 컴포넌트 | 위치 | 용도 |
|---------|------|------|
| `CompactHeader` | `components/CompactHeader.tsx` | 공통 헤더 |
| `KeyboardAwareWrapper` | `components/KeyboardAwareWrapper.tsx` | 키보드 대응 래퍼 |
| `CardSkeleton` | `components/LoadingSkeleton.tsx` | 로딩 스켈레톤 |
| `RefreshButton` | `components/RefreshButton.tsx` | 새로고침 버튼 |

## Safe Area 처리

```typescript
// SafeAreaView edges 옵션
edges={['left', 'right', 'bottom']}  // 상단은 커스텀 헤더로 처리

// insets 활용
const insets = useSafeAreaInsets();
style={{ paddingTop: 8 + insets.top }}
style={{ paddingBottom: Math.max(insets.bottom, 12) }}
```

## 플랫폼별 코드

```typescript
// 파일 확장자로 분리
useInAppUpdate.android.ts  // Android 전용
useInAppUpdate.ts          // 기본 (iOS/웹 폴백)

// Platform.select 사용
import { Platform } from 'react-native';
const fontSize = Platform.select({ ios: 16, android: 14, default: 15 });
```
