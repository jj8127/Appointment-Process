FC Onboarding App (Expo + Supabase)
===================================

FC 인적사항 등록, 경력조회/임시사번, 수당동의, 서류 업로드, 총무 대시보드 관리를 위한 크로스플랫폼 앱입니다.

환경 변수
--------

루트에 `.env`를 만들고 아래 값을 넣어주세요. `EXPO_PUBLIC_` 접두사는 앱 런타임에서 그대로 노출되므로 저장소에는 커밋하지 마세요.

```
EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

개발 서버 실행
-------------

```
npm install
npm start
```

Expo CLI가 QR 코드와 에뮬레이터/시뮬레이터 실행 옵션을 제공합니다.

주요 경로
--------

- 홈/허브: `app/index.tsx`
- 로그인(매직링크): `app/auth.tsx`
- FC 등록: `app/fc/new.tsx`
- 수당동의 입력: `app/consent.tsx`
- 서류 업로드: `app/docs-upload.tsx`
- 총무 대시보드: `app/dashboard.tsx`

Supabase 스키마 적용
-------------------

`supabase/schema.sql`을 Supabase SQL Editor 또는 supabase CLI로 실행해 테이블/시퀀스/RLS/스토리지 버킷(`fc-documents`)을 생성하세요. `generate_temp_id()` RPC가 임시사번을 발급하며, 스토리지 정책은 `authenticated` 사용자만 업로드/조회 가능하도록 설정되어 있습니다.

다음 작업 아이디어
-----------------

- 업로드 화면에서 업로드 파일 검증(용량/확장자) 및 재업로드 요청
- 대시보드 목록을 Supabase 쿼리 + React Query로 교체
- 상태 전이/검수/최종 URL 발송 로직을 서버와 연결
