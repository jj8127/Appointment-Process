---
name: supabase-edge-function
description: Supabase Edge Function 작성 가이드. Edge Function 생성, 수정, 또는 Supabase Functions 관련 질문 시 사용.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Supabase Edge Function 작성 가이드

이 프로젝트의 Edge Function 패턴과 규칙을 따릅니다.

## 디렉토리 구조

```
supabase/functions/
├── _shared/           # 공유 유틸리티
│   └── board.ts       # 게시판 관련 공유 함수
├── function-name/
│   └── index.ts       # 각 함수의 진입점
```

## 필수 패턴

### 1. CORS 헤더 처리

```typescript
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

serve(async (req: Request) => {
  // OPTIONS 프리플라이트 요청 처리
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ... 로직
});
```

### 2. 응답 형식

```typescript
// 성공 응답
return new Response(
  JSON.stringify({ ok: true, data: result }),
  { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
);

// 에러 응답
return new Response(
  JSON.stringify({ ok: false, code: 'error_code', message: '에러 메시지' }),
  { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
);
```

### 3. Actor 검증 패턴

```typescript
type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  // ... 기타 필드
};

// actor 필수 검증
if (!body.actor?.role || !body.actor?.residentId) {
  return json({ ok: false, code: 'unauthorized', message: 'Actor required' }, 401, origin);
}

// 역할 기반 권한 검증
if (!['admin', 'manager'].includes(body.actor.role)) {
  return json({ ok: false, code: 'forbidden', message: 'Admin or manager only' }, 403, origin);
}
```

### 4. Supabase 클라이언트 사용

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!  // service role 사용
);
```

## 보안 규칙

1. **주민번호(resident_id)**: 절대 평문 저장 금지, AES-GCM 암호화 필수
2. **비밀번호**: PBKDF2 + salt 해싱 (100,000 iterations)
3. **서비스 역할 키**: Edge Function에서만 사용, 클라이언트 노출 금지

## 배포

```bash
# 로컬 테스트
supabase functions serve function-name --env-file .env.local

# 배포
supabase functions deploy function-name
```

## 참고 파일

기존 Edge Function 예시:
- `supabase/functions/board-list/index.ts` - 목록 조회 패턴
- `supabase/functions/board-create/index.ts` - 생성 패턴
- `supabase/functions/_shared/board.ts` - 공유 유틸리티
