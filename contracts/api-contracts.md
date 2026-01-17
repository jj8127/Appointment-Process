# API Contracts

> 이 문서는 Edge Functions API의 "계약"입니다.
> API 변경 시 이 문서를 먼저 업데이트하세요.

---

## 1. 인증 API

### 1.1 request-signup-otp
회원가입 OTP 요청

**Request**
```typescript
{
  phone: string;  // 전화번호 (예: "01012345678")
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;  // 에러 시 메시지
}
```

### 1.2 verify-signup-otp
OTP 검증

**Request**
```typescript
{
  phone: string;
  code: string;  // 6자리 코드
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

### 1.3 set-password
비밀번호 설정 (회원가입 완료)

**Request**
```typescript
{
  phone: string;
  password: string;
  name: string;
  affiliation: string;
  recommender?: string;
  email?: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

### 1.4 login-with-password
로그인

**Request**
```typescript
{
  phone: string;
  password: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  role: 'fc' | 'admin' | 'manager';
  displayName: string;
  token?: string;  // JWT
  message?: string;
}
```

### 1.5 request-password-reset
비밀번호 재설정 OTP 요청

**Request**
```typescript
{
  phone: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

### 1.6 reset-password
비밀번호 재설정 완료

**Request**
```typescript
{
  phone: string;
  token: string;      // OTP 코드
  newPassword: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

---

## 2. 신원 확인 API

### 2.1 store-identity
주민번호/주소 암호화 저장

**Request**
```typescript
{
  phone: string;
  residentNumber: string;  // 주민번호 (평문)
  address: string;
  addressDetail?: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

**보안 노트**
- 주민번호는 서버에서 즉시 암호화
- 클라이언트에서 암호화 시도 금지
- 로그에 평문 출력 금지

---

## 3. 계정 관리 API

### 3.1 delete-account
FC 계정 삭제

**Request**
```typescript
{
  phone: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

**동작**
- fc_profiles 삭제
- fc_identity_secure 삭제
- fc_credentials 삭제
- fc_documents 삭제
- Storage 파일 삭제

---

## 4. 게시판 API

> 게시판 관련 기능은 Edge Functions로만 접근한다. (RLS: service_role 전용)
> 모든 요청은 `actor` 정보를 포함하며, 서버에서 실제 계정 존재/권한을 검증해야 한다.

### 공통 타입
```typescript
type Actor = {
  role: 'admin' | 'manager' | 'fc';
  residentId: string;   // 전화번호(숫자)
  displayName: string;  // 화면 표시 이름
};
```

### 4.1 board-categories-list
카테고리 목록 조회

**Request**
```typescript
{
  actor: Actor;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: Array<{
    id: string;
    name: string;
    slug: string;
    sortOrder: number;
    isActive: boolean;
  }>;
}
```

### 4.2 board-category-create (admin)
카테고리 추가 (관리자 전용)

**Request**
```typescript
{
  actor: Actor;
  name: string;
  slug: string;
  sortOrder?: number;
  isActive?: boolean;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: { id: string };
}
```

### 4.3 board-category-update (admin)
카테고리 수정 (관리자 전용)

**Request**
```typescript
{
  actor: Actor;
  id: string;
  name?: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.4 board-list
게시글 목록 조회 (핀 게시글은 우선 정렬)

**Request**
```typescript
{
  actor: Actor;
  categoryId?: string;
  search?: string; // 제목 + 본문 + 작성자
  sort?: 'created' | 'latest' | 'comments' | 'reactions';
  order?: 'asc' | 'desc'; // default: desc
  cursor?: string;        // pagination cursor (created_at/updated_at 기반)
  limit?: number;         // default: 20
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: {
    items: Array<{
      id: string;
      categoryId: string;
      title: string;
      contentPreview: string;
      authorName: string;
      authorRole: 'admin' | 'manager';
      createdAt: string;
      updatedAt: string;
      editedAt?: string;
      isPinned: boolean;
      isMine: boolean;
      stats: {
        commentCount: number;
        reactionCount: number;
        attachmentCount: number;
      };
      reactions?: {
        like: number;
        heart: number;
        check: number;
        smile: number;
      };
      attachments?: Array<{
        id: string;
        fileType: 'image' | 'file';
        fileName: string;
        fileSize: number;
        storagePath: string;
        signedUrl?: string;
      }>;
    }>;
    nextCursor?: string | null;
  };
}
```

### 4.5 board-detail
게시글 상세 조회 (첨부/댓글/반응 포함)

**Request**
```typescript
{
  actor: Actor;
  postId: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: {
    post: {
      id: string;
      categoryId: string;
      title: string;
      content: string;
      authorName: string;
      authorRole: 'admin' | 'manager';
      createdAt: string;
      updatedAt: string;
      editedAt?: string;
      isPinned: boolean;
      isMine: boolean;
    };
    attachments: Array<{
      id: string;
      fileType: 'image' | 'file';
      fileName: string;
      fileSize: number;
      mimeType?: string;
      storagePath: string;
      signedUrl?: string;
    }>;
    reactions: {
      like: number;
      heart: number;
      check: number;
      smile: number;
      myReaction?: 'like' | 'heart' | 'check' | 'smile' | null;
    };
    comments: Array<{
      id: string;
      parentId?: string | null;
      content: string;
      authorName: string;
      authorRole: 'admin' | 'manager' | 'fc';
      createdAt: string;
      editedAt?: string;
      stats: { likeCount: number; replyCount: number };
      isMine: boolean;
      isLiked: boolean;
    }>;
  };
}
```

### 4.6 board-create (admin/manager)
게시글 작성

**Request**
```typescript
{
  actor: Actor;
  categoryId: string;
  title: string;
  content: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: { id: string };
}
```

### 4.7 board-update (admin / manager-own)
게시글 수정 (관리자 전체, 본부장 본인 글만)

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  categoryId?: string;
  title?: string;
  content?: string;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.8 board-delete (admin / manager-own)
게시글 삭제 (완전 삭제 + 첨부 파일 삭제)

**Request**
```typescript
{
  actor: Actor;
  postId: string;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.9 board-pin (admin)
게시글 상단 고정/해제

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  isPinned: boolean;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.10 board-comment-create
댓글/대댓글 작성

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  parentId?: string; // 대댓글일 때만
  content: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: { id: string };
}
```

**제한**
- 댓글 깊이: 최대 2 (댓글 → 답글 → 답글의 답글)

### 4.11 board-comment-update (own)
댓글 수정 (본인만)

**Request**
```typescript
{
  actor: Actor;
  commentId: string;
  content: string;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.12 board-comment-delete (own)
댓글 삭제 (본인만)

**Request**
```typescript
{
  actor: Actor;
  commentId: string;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.13 board-comment-like-toggle
댓글 좋아요 토글

**Request**
```typescript
{
  actor: Actor;
  commentId: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: { liked: boolean; likeCount: number };
}
```

### 4.14 board-reaction-toggle
게시글 반응 토글 (사용자당 1개)

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  reactionType: 'like' | 'heart' | 'check' | 'smile';
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: { myReaction: 'like' | 'heart' | 'check' | 'smile' | null };
}
```

### 4.15 board-attachment-sign
첨부 업로드용 Signed URL 발급

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  files: Array<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    fileType: 'image' | 'file';
  }>;
}
```

**Response**
```typescript
{
  ok: boolean;
  data?: Array<{
    storagePath: string;
    signedUrl: string;
  }>;
}
```

### 4.16 board-attachment-finalize
첨부 메타데이터 등록

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  files: Array<{
    storagePath: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    fileType: 'image' | 'file';
  }>;
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

### 4.17 board-attachment-delete (admin / manager-own)
첨부파일 삭제 (스토리지 + 메타데이터)

**Request**
```typescript
{
  actor: Actor;
  postId: string;
  attachmentIds: string[];
}
```

**Response**
```typescript
{
  ok: boolean;
}
```

---

## 5. 공통 응답 형식

모든 Edge Function은 다음 형식을 따름:

```typescript
interface ApiResponse<T = any> {
  ok: boolean;           // 성공 여부
  data?: T;              // 성공 시 데이터
  message?: string;      // 에러/안내 메시지
  code?: string;         // 에러 코드 (옵션)
}
```

### 에러 코드
| 코드 | 설명 |
|------|------|
| INVALID_PHONE | 잘못된 전화번호 형식 |
| USER_NOT_FOUND | 사용자 없음 |
| INVALID_PASSWORD | 비밀번호 틀림 |
| OTP_EXPIRED | OTP 만료 |
| OTP_INVALID | OTP 틀림 |
| DUPLICATE_USER | 이미 가입된 사용자 |
| DUPLICATE_RESIDENT_ID | 중복된 주민번호 |

---

## 6. 클라이언트 호출 패턴

```typescript
// 표준 호출 패턴
const { data, error } = await supabase.functions.invoke('function-name', {
  body: { ... },
});

if (error) {
  // 네트워크 오류 등
  throw error;
}

if (!data?.ok) {
  // 비즈니스 로직 실패
  Alert.alert('알림', data?.message ?? '요청에 실패했습니다.');
  return;
}

// 성공 처리
```

---

## 7. 변경 이력

| 날짜 | 변경 내용 | 작성자 |
|------|----------|--------|
| 2025-01-10 | 초기 문서 작성 | AI |
| 2026-01-13 | 게시판 Edge Functions 계약 추가 | AI |
| 2026-01-15 | 첨부 삭제 API 추가 + 댓글 깊이 제한 명시 | AI |
