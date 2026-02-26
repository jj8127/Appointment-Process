# 작업 상세 로그 (Work Detail)

> **상세 이력 누적 파일**입니다.  
> 최근 1개월 Git 이력(`2026-01-12` ~ `2026-02-11`, 총 44 commits)을 기준으로 재구성했습니다.
>
> 요약 인덱스는 [WORK_LOG.md](WORK_LOG.md)를 확인하세요.

---

## <a id="20260226-4"></a> 2026-02-26 | 관리자 웹 헤더 벨 알림센터 추가 + 사이드바 알림/공지 제거(클릭 이동/확인 카운트 차감)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청 반영:
  - 관리자 웹 사이드바에서 `알림/공지` 항목 제거
  - 앱과 동일하게 헤더의 종(벨) 아이콘으로 알림 목록 확인 가능하도록 개선
- 구현:
  - `web/src/components/DashboardNotificationBell.tsx` 신규 생성
    - `fc-notify`의 `inbox_list`를 사용해 알림/공지 통합 목록 조회
    - `request_board`/`온보딩`/`공지` 출처 배지 + 카테고리 라벨 표시
    - 항목 클릭 시 관련 페이지 라우팅:
      - request_board 메시지/이벤트 → `/dashboard/messenger?channel=request-board`
      - 내부 메시지/기타 타깃 URL → 웹 대시보드 경로로 정규화 후 이동
      - 공지(board_notice 포함) → 게시판 상세(`/dashboard/board?postId=...`) 또는 공지 상세
    - `모두 확인` 버튼 제공
    - 확인(항목 클릭) 시 로컬 읽음 상태 저장으로 벨 카운트 즉시 감소
  - `web/src/app/dashboard/layout.tsx`
    - 헤더 우측 사용자 메뉴 앞에 `DashboardNotificationBell` 배치
    - 사이드바 네비 `알림/공지` 메뉴 제거
- 읽음 카운트 처리 방식:
  - 서버 스키마에 개별 `is_read` 컬럼이 없어 사용자별 확인 상태는 브라우저 로컬 저장소(`dashboard-notification-seen:*`)로 관리
  - 사용자가 항목을 확인(클릭)하면 해당 ID가 읽음으로 기록되고 벨 숫자에서 즉시 제외

**핵심 파일**:
- `web/src/components/DashboardNotificationBell.tsx`
- `web/src/app/dashboard/layout.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 lint:
  - `cd web && npm run lint -- src/app/dashboard/layout.tsx src/components/DashboardNotificationBell.tsx` 통과
- 웹 빌드(TypeScript 포함):
  - `cd web && npm run build` 통과
- 거버넌스:
  - `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 관리자 계정 실기 확인:
  - 헤더 벨 목록 노출/새로고침/모두 확인 동작
  - 알림 항목 클릭 시 대상 화면 이동
  - 클릭 후 벨 카운트 감소(즉시 반영)

---

## <a id="20260226-3"></a> 2026-02-26 | FC 가람지사 메신저 대상 목록/총무 채팅 복구(RLS 우회 + targetId=admin 처리)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 이슈 대응:
  - FC가 `메신저 -> 가람지사 메신저` 진입 시 본부장 버튼이 보이지 않음
  - 총무 버튼이 보여도 채팅 진입/발송이 동작하지 않음
- 원인 정리:
  - 기존 FC 대상 목록 로딩이 앱 anon 클라이언트에서 `manager_accounts` 직접 조회에 의존해 RLS 환경에서 빈 목록이 반환됨
  - `chat.tsx`에서 `targetId`를 무조건 전화번호 sanitize하여 `targetId=admin`이 빈 문자열로 변환됨
- 조치:
  - `supabase/functions/fc-notify/index.ts`에 `type: 'chat_targets'` 분기 추가
    - 입력 `resident_id` 검증
    - `fc_profiles(phone, signup_completed=true)` 확인 후 서비스 롤로 `manager_accounts(active=true)` 조회
    - `managers: [{ name, phone }]` 응답 반환
  - `app/chat.tsx`에서 FC 대상 목록 로딩을 신규 함수 호출로 전환
    - 본부장 목록 + `총무` 고정 항목을 함께 렌더링하는 대상 선택 UI 유지
  - `targetId` 정규화 보정:
    - `targetId === 'admin'`이면 sanitize하지 않고 그대로 사용
    - 총무 채팅 `otherId`가 빈 문자열로 떨어지는 현상 제거

**핵심 파일**:
- `app/chat.tsx`
- `supabase/functions/fc-notify/index.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- app/chat.tsx app/messenger.tsx app/admin-messenger.tsx` 통과
- 테스트:
  - `npm test -- --runInBand` 통과 (2 suites / 53 tests)
- 거버넌스:
  - `node scripts/ci/check-governance.mjs` 통과
- 함수 배포:
  - `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료
- 런타임 API 확인:
  - `fc-notify` `type=chat_targets, resident_id=01064122836` 호출 성공
  - 응답 managers에 `서선미 / 01093118127` 포함 확인

**다음 단계**:
- 실기기(Android/iOS)에서 FC 계정으로 `가람지사 메신저` 진입 시
  - 본부장/총무 대상 목록 노출 여부
  - 각각 선택 후 송수신/읽음 처리까지 확인

---

## <a id="20260226-2"></a> 2026-02-26 | 앱 게시판 관리 목록 카테고리 표시 추가(공지/교육 등)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청 반영:
  - 앱의 `게시판 관리` 목록 카드에서 글의 유형(카테고리)이 보이지 않던 문제를 개선
  - 예: `공지`, `교육`, `서류`, `일반`
- 구현 방식:
  - `app/admin-board-manage.tsx`에서 `fetchBoardCategories`를 함께 조회
  - `categoryId -> categoryName` 매핑(Map) 생성
  - 목록 카드 제목 하단에 카테고리 배지 렌더링 추가
  - 카테고리별 색상 톤 적용:
    - 공지: 오렌지 계열
    - 교육: 블루 계열
    - 서류: 그린 계열
    - 기타: 그레이 계열

**핵심 파일**:
- `app/admin-board-manage.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 모바일 lint:
  - `npm run lint -- app/admin-board-manage.tsx` 통과

**다음 단계**:
- 실기기에서 게시판 관리 목록 진입 후 카테고리 배지 노출/색상 확인

---

## <a id="20260226-1"></a> 2026-02-26 | 관리자 웹 공지/게시판 공지 일관화(통합 목록 + 게시판 딥링크 + 삭제 경로 통합)

**Commit**: `working tree`  
**작업 내용**:
- 배경:
  - 모바일에서는 이미 `공지 페이지`와 `게시판 공지(slug=notice)`를 통합 소스로 처리하고 있었지만,
    관리자 웹(`알림/공지`)은 `notices` 테이블만 조회해 게시판 공지가 분리되어 보이던 상태
- 서버 API 통합:
  - `web/src/app/api/admin/notices/route.ts`에서 목록 조회 시
    - 기존 `notices` + 게시판 `board_posts(category_slug=notice)`를 병합
    - 게시판 공지 ID를 `board_notice:{postId}` 형식으로 표준화
    - `created_at` 기준 통합 정렬
  - 상세 조회(`GET id`)에서도 `board_notice:*` 식별자를 처리하도록 확장
    - 게시판 첨부(`board_attachments`)는 signed URL로 매핑
  - 삭제(`DELETE`)도 `board_notice:*` 식별자 지원
    - 게시글 삭제 + 스토리지(`board-attachments`) 정리 경로 포함
  - 수정(`PATCH`)은 게시판 공지에 대해 명시적으로 차단
    - 안내 메시지: `게시판 공지는 게시판에서 수정해주세요.`
- 관리자 화면 동작 일관화:
  - `web/src/app/dashboard/notifications/page.tsx`
    - 통합 목록에서 `board_notice:*` 클릭 시 `/dashboard/board?postId=...`로 이동
    - 편집 버튼도 게시판 공지인 경우 게시판 상세 진입으로 연결
  - `web/src/app/dashboard/notifications/[id]/page.tsx`
    - `board_notice:*` 접근 시 자동으로 게시판 상세로 리다이렉트
  - `web/src/app/dashboard/notifications/[id]/edit/page.tsx`
    - `board_notice:*` 편집 URL 접근 시 게시판으로 리다이렉트
- 게시판 상세 딥링크 처리:
  - `web/src/app/dashboard/board/page.tsx`
    - `postId` 쿼리 파라미터를 읽어 게시글 상세 모달을 자동 오픈
    - 모달 닫기 시 `postId` 쿼리를 제거해 URL/상태 동기화

**핵심 파일**:
- `web/src/app/api/admin/notices/route.ts`
- `web/src/app/dashboard/notifications/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`
- `web/src/app/dashboard/notifications/[id]/edit/page.tsx`
- `web/src/app/dashboard/board/page.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 lint:
  - `cd web && npm run lint -- src/app/api/admin/notices/route.ts src/app/dashboard/notifications/page.tsx src/app/dashboard/notifications/[id]/page.tsx src/app/dashboard/notifications/[id]/edit/page.tsx src/app/dashboard/board/page.tsx` 통과
- 웹 빌드(TypeScript 포함):
  - `cd web && npm run build` 통과

**다음 단계**:
- 운영 환경에서 관리자 계정으로 실제 확인:
  - `알림/공지` 목록에 게시판 공지와 일반 공지가 함께 노출되는지
  - 게시판 공지 클릭 시 게시판 상세 모달로 진입하는지
  - 게시판 공지 삭제 시 목록/게시판/첨부파일 정리가 함께 되는지

---

## <a id="20260225-16"></a> 2026-02-25 | FC 삭제 완전 정리 보강(웹/엣지/fallback 경로 통합)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 이슈 대응:
  - 총무 웹에서 FC 삭제 후 일부 데이터(알림/토큰/게시판 반응/브릿지 프로필 등)가 남는 케이스를 제거
- 삭제 범위 확장:
  - `resident_id` 기준 삭제를 단일 값이 아니라 `digits/raw/masked` 식별자 세트로 통합 처리
  - 기존 누락 테이블 삭제 추가:
    - `device_tokens`
    - `web_push_subscriptions`
    - `board_comment_likes`
    - `profiles`(`fc_id` 기반)
  - `exam_registrations`, `notifications`는 `fc_id` + `resident_id` 양쪽 축에서 삭제
  - 채팅 파일 삭제 경로 정규화(`.../chat-uploads/...` -> 버킷 내부 path) 보강
  - `fc_credentials`, `fc_identity_secure` 명시 삭제(캐스케이드 누락 대비)
  - 링크된 `profiles.id`에 대해 `auth.admin.deleteUser` 호출로 auth 사용자까지 정리 시도
- 경로별 정합성:
  - 총무 웹 삭제 API: `web/src/app/api/fc-delete/route.ts`
  - 모바일/공용 계정삭제 함수: `supabase/functions/delete-account/index.ts`
  - 모바일 fallback 삭제(`admin-action deleteFc`)도 동일 기준 반영
  - 웹 설정의 FC 자가 삭제는 직접 테이블 삭제 대신 `delete-account` 함수 호출로 단일화

**핵심 파일**:
- `web/src/app/api/fc-delete/route.ts`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/dashboard/settings/page.tsx`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 빌드: `cd web && npm run build` 통과 (TypeScript 포함)
- 참고: 루트 `expo lint`는 웹 alias/deno remote import 해석 한계로 파일 단위 검증에 부적합하여 웹 빌드 기준으로 검증

**다음 단계**:
- 프로덕션 반영 후 실데이터로 1건 삭제 검증:
  - 삭제 전/후 `fc_profiles`, `fc_credentials`, `fc_identity_secure`, `notifications`, `device_tokens`, `web_push_subscriptions`, `messages`, `board_*` 레코드 카운트 비교

---

## <a id="20260225-15"></a> 2026-02-25 | 웹 빌드 타입 오류 핫픽스(`calcStep` 불필요 분기 제거)

**Commit**: `af4ca84`  
**작업 내용**:
- Vercel 프로덕션 빌드(TypeScript) 실패 원인 수정:
  - 파일: `web/src/lib/shared.ts`
  - 함수: `calcStep`
  - 증상: `profile.status`가 상단 분기에서 이미 좁혀진 상태에서 하단에 `profile.status !== 'final-link-sent'` 비교가 남아 타입 충돌 발생
  - 조치: 문서 승인 완료 후 분기에서 불필요한 `final-link-sent` 재비교/`return 5` 경로 제거, `return 4`로 단순화
- 영향:
  - 런타임 동작 변경 없음(상단에서 `final-link-sent`/양 트랙 완료는 이미 Step 5 처리)
  - 타입 체크 경고만 제거하여 CI/Vercel 빌드 통과 복구

**핵심 파일**:
- `web/src/lib/shared.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 웹 빌드: `cd web && npm run build` 통과
- 거버넌스 체크: `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 해당 문서 동기화 커밋 푸시 후 GitHub Actions `Governance Check` 재실행/통과 확인

---

## <a id="20260225-14"></a> 2026-02-25 | FC 위촉 2트랙(생명/손해) 완료 상태 분기 도입

**Commit**: `working tree`  
**작업 내용**:
- 요구사항 반영:
  - FC 가입 시 위촉 완료 상태를 `none / life_only / nonlife_only / both`로 선택할 수 있도록 추가
  - 기존 `status` 단일 분기로 발생하던 혼선을 줄이기 위해 생명/손해 완료 플래그를 별도 저장
- 앱 가입/저장 경로:
  - `signup -> signup-verify -> signup-password -> set-password` payload에 `commissionStatus` 연결
  - `set-password`에서 `commissionStatus`를 `status + life/nonlife completion`으로 매핑
    - `none` -> `draft`, false/false
    - `life_only` -> `appointment-completed`, true/false
    - `nonlife_only` -> `appointment-completed`, false/true
    - `both` -> `final-link-sent`, true/true
  - 신규 컬럼 미적용 환경에서도 가입 실패를 피하도록 컬럼 누락 fallback 처리 추가
- 홈 화면/단계 로직:
  - `calcStep` 우선순위 보정: `final-link-sent`는 즉시 Step 5, 단일 트랙 완료는 Step 4 우선
  - 위촉 배지를 명확화: `생명/손해` 각각 `완료/대기`로 표시 + `위촉 완료 X/2` 요약 노출
  - FC 홈의 두 렌더 경로 모두 동일 배지/요약이 노출되도록 정렬
- 웹 관리자 정합성:
  - shared `calcStep`, `getAppointmentProgress`도 동일 completion 플래그를 반영해 Step 집계/표시 정렬
- 데이터/스키마:
  - `fc_profiles`에 `life_commission_completed`, `nonlife_commission_completed` 컬럼 추가
  - 마이그레이션에서 기존 `appointment_date_*` 데이터 기반 backfill + status 정규화 반영
- 보강:
  - `app/fc/new.tsx`에서 기존 프로필 수정 시 status를 `draft`로 덮어쓰던 동작 제거(완료 상태 보존)

**핵심 파일**:
- `app/signup.tsx`
- `app/signup-verify.tsx`
- `app/signup-password.tsx`
- `app/index.tsx`
- `app/fc/new.tsx`
- `supabase/functions/set-password/index.ts`
- `types/fc.ts`
- `web/src/types/fc.ts`
- `web/src/lib/shared.ts`
- `web/src/app/dashboard/page.tsx`
- `supabase/schema.sql`
- `supabase/migrations/20260225000003_add_commission_completion_flags.sql`

**검증**:
- 모바일 코드 lint:
  - `npm run lint -- app/signup.tsx app/signup-verify.tsx app/signup-password.tsx app/index.tsx app/fc/new.tsx types/fc.ts` 통과
- 웹 공유 로직 lint:
  - `cd web && npm run lint -- src/lib/shared.ts src/types/fc.ts src/app/dashboard/page.tsx` 통과
- 거버넌스 체크:
  - `node scripts/ci/check-governance.mjs` 통과
- 배포/마이그레이션:
  - `supabase functions deploy set-password --project-ref ubeginyxaotcamuqpmud` 성공
  - `supabase db push --linked` 성공 (`20260225000003_add_commission_completion_flags.sql` 적용 확인)
  - 서비스키 조회 검증: `fc_profiles(id,phone,status,life_commission_completed,nonlife_commission_completed)` select 성공

**다음 단계**:
- DB migration + set-password 함수 배포 후 실기기에서 4개 가입 케이스(미완료/생명만/손해만/모두완료) 단계/배지 확인

---

## <a id="20260225-13"></a> 2026-02-25 | request_board 본부장(FC 리더) 브릿지 권한 정렬 + 재테스트

**Commit**: `working tree`  
**작업 내용**:
- 사용자 정책 정렬:
  - app의 `manager(본부장)`는 request_board `designer`가 아니라 `fc` 계열로 취급하도록 브릿지 로그인 경로 재정렬
  - request_board designer 전용 모드 활성화는 `rbBridgeLogin` 결과가 실제 `designer`일 때만 true가 되도록 고정
- 세션/알림 경로 분리:
  - `use-session`에 `requestBoardRole('fc'|'designer'|null)` 상태 추가
  - request_board 알림함 조회 시 app role 대신 `requestBoardRole` 우선 사용
  - designer 브릿지 계정이 아닌 경우 inbox 조회는 `role=fc + resident_id`로 고정
- 배포 반영:
  - `supabase/functions/login-with-password` 프로덕션 재배포 완료
  - manager 계정 브릿지 토큰 role을 `designer` -> `fc`로 전환
- 추가 UX:
  - request_board 화면 헤더에 웹 URL 복사 버튼 추가

**핵심 파일**:
- `hooks/use-login.ts`
- `hooks/use-session.tsx`
- `app/request-board.tsx`
- `app/notifications.tsx`
- `supabase/functions/login-with-password/index.ts`

**검증**:
- 정적 검증:
  - `npm run lint -- hooks/use-login.ts hooks/use-session.tsx app/request-board.tsx app/notifications.tsx` 통과
- 배포 검증:
  - `supabase functions deploy login-with-password --project-ref ubeginyxaotcamuqpmud` 성공
- API 실측:
  - `login-with-password(01093118127)` -> `role=manager`, `requestBoardBridgeToken` 발급 확인
  - `POST /api/auth/bridge-login` -> manager token으로 `role=fc` 로그인 성공(403 재현 해소)
  - request_board DM 송신 후 `fc-notify inbox_list(role=fc,resident_id=01093118127)`에서 `request_board_message` 적재 확인

**다음 단계**:
- 모바일 앱 빌드/OTA 배포 후 실기기에서 본부장 계정 로그인 -> 설계페이지 진입 -> 알림센터 반영을 UI 기준으로 최종 확인

---

## <a id="20260225-12"></a> 2026-02-25 | 거버넌스 CI 복구(문서/스키마 동기화)

**Commit**: `working tree`  
**작업 내용**:
- GitHub Actions `governance-check` 실패 원인 대응:
  - `Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.`
  - `Schema change policy violation: update supabase/schema.sql and supabase/migrations/*.sql together.`
- 수정 반영:
  - `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md` 동시 업데이트
  - `supabase/schema.sql`에 `notices.created_by` 스키마 동기화 보강
  - 동기화용 no-op 마이그레이션 추가:
    - `supabase/migrations/20260225000002_schema_sync_notices_created_by.sql`

**핵심 파일**:
- `supabase/schema.sql`
- `supabase/migrations/20260225000002_schema_sync_notices_created_by.sql`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 로컬 실행: `node scripts/ci/check-governance.mjs` 통과

**다음 단계**:
- 해당 커밋 푸시 후 GitHub Actions `Governance Check` 재실행/통과 확인

---

## <a id="20260225-11"></a> 2026-02-25 | request_board 메신저 첨부파일 UI 완성(모바일)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요청(이전 세션 중단 지점) 기준으로 `request_board` 연동 메신저 화면의 첨부 기능을 마무리:
  - 갤러리 이미지 선택(`expo-image-picker`)
  - 문서 선택(`expo-document-picker`)
  - 전송 전 pending 첨부 목록(가로 strip) + 개별 제거
  - 전송 시 파일 우선 업로드(`rbUploadAttachments`) 후 메시지 전송(`rbSendMessage`/`rbSendDmMessage`)
  - 첨부만 있는 메시지도 전송 가능하도록 본문 placeholder 처리(`[첨부파일]`)
- 대화 렌더링 확장:
  - 이미지 첨부: 썸네일 그리드 + 탭 시 전체화면 미리보기 모달
  - 일반 파일: 파일 카드(아이콘/파일명/용량) + 탭 시 URL 오픈
- 타입 안정화:
  - `FlatList` 제네릭/콜백 파라미터 타입 명시
  - 신규 렌더 경로 `implicit any` 제거
  - 불필요한 `as any` 제거(아이콘 name 타입/메시지 sender 접근)

**핵심 파일**:
- `app/request-board-messenger.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `npm run lint -- app/request-board-messenger.tsx` 통과
- `npx tsc --noEmit --pretty false` 실행 후 파일 단위 확인:
  - `request-board-messenger.tsx` 오류 없음
  - 참고: 프로젝트 내 기존 다른 파일 오류(`app/fc/new.tsx`, `app/notifications.tsx`)는 별도 선행 이슈로 잔존
- request_board 서버 계약 대조:
  - `/api/messages/attachments/upload` 경로 및 `attachments[{fileName,fileType,fileSize,fileUrl}]` payload 형식 일치 확인

**다음 단계**:
- Android/iOS 실기기에서 request 채팅/DM 각각 아래 시나리오 검증:
  - 이미지/문서 첨부 전송
  - 첨부파일만 전송(텍스트 없음)
  - 파일 카드 탭 시 외부 열기
  - 이미지 전체화면 미리보기 닫기/복귀

---

## <a id="20260225-9"></a> 2026-02-25 | `fc-notify` target_id role 무관 통합 발송

**Commit**: `working tree`  
**작업 내용**:
- 사용자 이슈 재현:
  - 같은 번호라도 `device_tokens.role='admin'` 인 경우 `target_role='fc'` 발송에서 `sent=0` 발생
  - 실제 예시: `01093118127`은 토큰 2건이 모두 `admin` role이라 기존 로직에서 누락
- 코드 수정:
  - `supabase/functions/fc-notify/index.ts`
  - `notify/message` 경로에서 `target_id`가 있으면 `role` 필터를 제거하고 `resident_id=target_id` 기준으로 토큰 조회
  - `fc_update/admin_update` 레거시 분기 중 FC 대상 경로도 `resident_id` 기준 조회로 정렬
  - `dedupeTokens()` 추가로 동일 Expo 토큰 중복 발송 방지
- 기대 효과:
  - `target_id` 지정 단건 알림은 FC/Admin/Manager 어느 role로 토큰이 등록되어 있어도 동일 번호 디바이스에 발송

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- 함수 배포: `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료
- 라이브 검증:
  - `POST https://adminweb-red.vercel.app/api/fc-notify`
  - payload: `type=notify,target_role=fc,target_id=01093118127`
  - 결과: `status=200`, `sent=2` 확인 (수정 전 동일 대상 `sent=0`)

**다음 단계**:
- `request_board` 브릿지 경로에서 서선미 실기기 수신 확인
- 필요 시 `target_id` 포맷 유효성(11자리 숫자) 실패 로그를 별도 집계

---

## <a id="20260225-10"></a> 2026-02-25 | 알림 출처 구분 강화(온보딩앱 vs 설계요청)

**Commit**: `working tree`  
**작업 내용**:
- 사용자 요구사항: 동일 앱에서 수신되는 알림을
  - `fc-onboarding-app` 자체 이벤트
  - `request_board` 브릿지 이벤트
  로 명확히 구분 가능하도록 개선
- 서버(즉시 반영) 변경:
  - `supabase/functions/fc-notify/index.ts`
  - `request_board_*` 카테고리 알림은 Expo Push 제목에 `[설계요청]` 접두어 자동 부여
  - Push data에 `source`(`request_board`/`fc_onboarding`) 포함
- 앱 UI(앱 업데이트 반영) 변경:
  - `app/notifications.tsx`
  - 알림센터 목록에 출처 배지 추가: `설계요청` / `온보딩앱`
  - `request_board_*` 카테고리 라벨을 사용자 친화 문구로 정규화
    - 예: `request_board_accepted -> 의뢰 수락`, `request_board_message -> 새 메시지`
  - request_board 알림 탭 시 온보딩 내부 라우트로 오인 이동하지 않도록 안내 알림 처리

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `app/notifications.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료
- `npm run lint -- app/notifications.tsx` 통과
- 라이브 호출(`POST https://adminweb-red.vercel.app/api/fc-notify`) 발송 성공 확인

**다음 단계**:
- 서버 푸시 제목 접두어(`[설계요청]`)는 즉시 적용됨
- 알림센터 출처 배지 UI는 모바일 앱 빌드/배포 후 실사용 반영

---

## <a id="20260224-8"></a> 2026-02-24 | 데스크톱 알림 미표시 대응: 서비스워커/정적자산 경로 보정

**Commit**: `working tree`
**작업 내용**:
- 배포본 실측으로 원인 후보 확정:
  - `https://adminweb-red.vercel.app/sw.js`가 `307 -> /auth`로 리다이렉트되던 상태 확인
  - 서비스워커/정적자산 접근 경로가 인증 미들웨어에 영향을 받으면 브라우저 푸시 수신 표시가 불안정해질 수 있음
- 코드 수정:
  - `web/middleware.ts`
    - matcher를 정적 파일/`sw.js` 제외 패턴으로 보강해 서비스워커·정적자산 요청이 인증 리다이렉트 대상이 되지 않도록 조정
  - `web/public/sw.js`
    - `install/activate`에서 `skipWaiting`/`clients.claim` 추가
    - `push` 이벤트 payload를 `json()` 실패 시 `text()` fallback 하도록 방어
    - 알림 아이콘/배지 경로를 존재하는 `/favicon.ico`로 통일
  - `web/src/app/dashboard/page.tsx`
    - `알림 테스트` 버튼의 icon/badge 경로를 `/favicon.png` -> `/favicon.ico`로 수정
- 운영 반영:
  - 웹 프로덕션 재배포 완료
  - 새 배포: `https://admin-ff5m38mw8-jun-jeongs-projects.vercel.app`
  - alias: `https://adminweb-red.vercel.app`

**핵심 파일**:
- `web/middleware.ts`
- `web/public/sw.js`
- `web/src/app/dashboard/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- middleware.ts src/app/dashboard/page.tsx public/sw.js` 통과
- 외부 응답 확인:
  - `curl -I https://adminweb-red.vercel.app/sw.js` => `200 OK`
  - `curl -I https://adminweb-red.vercel.app/adminWebLogo.png` => `200 OK`
  - `curl -I https://adminweb-red.vercel.app/favicon.ico` => `200 OK`
- 체인 검증:
  - `POST https://adminweb-red.vercel.app/api/fc-notify` 직접 호출 결과
  - 응답에 `web_push: { ok: true, status: 200, sent: 1, failed: 0 }` 확인

**다음 단계**:
- 운영 브라우저에서 `Ctrl+F5` 1회 후 `알림 테스트` 버튼 재실행(신규 SW 활성화 반영)
- 그래도 OS 배너가 없으면 코드 경로가 아니라 OS/브라우저 정책 문제이므로 Windows의 Chrome 앱 알림 허용/집중 모드(Focus) 해제/Chrome 조용한 알림 UI 설정을 점검

---

## <a id="20260224-7"></a> 2026-02-24 | 데스크톱 알림 미표시 원인 분리 진단 보강

**Commit**: `working tree`
**작업 내용**:
- 서버-사이드 진단 보강:
  - `supabase/functions/fc-notify/index.ts`에서 admin 대상 웹푸시 콜백 결과를 응답에 포함하도록 확장
  - 응답 필드: `web_push: { ok, status, sent, failed, reason }`
  - 대상 경로: `type=notify`, `type=message`, `fc_update/fc_delete` 계열 admin 웹푸시 호출
- 클라이언트-사이드 진단 보강:
  - 대시보드 헤더에 `알림 테스트` 버튼 추가
  - 클릭 시 Notification permission 확인/요청 후 즉시 테스트 알림(`serviceWorker.showNotification` 우선, fallback `new Notification`) 발송
  - 결과를 토스트로 안내해 브라우저/OS 알림 차단 여부를 즉시 확인 가능
- 운영 반영:
  - `fc-notify` 재배포(버전 49)
  - 웹 프로덕션 재배포(`admin-fqbyh32rq-jun-jeongs-projects.vercel.app`, alias `adminweb-red`)

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `web/src/app/dashboard/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx` 통과
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료 (version 49)
- 직접 invoke 결과:
  - `web_push: { ok: true, status: 200, sent: 1, failed: 0 }` 확인
- Vercel deploy ready + alias 연결 확인:
  - `https://admin-fqbyh32rq-jun-jeongs-projects.vercel.app`
  - `https://adminweb-red.vercel.app`

**다음 단계**:
- 운영자가 대시보드 상단 `알림 테스트` 버튼을 눌러 로컬 OS 알림 표시 여부 확인
- 테스트 알림도 미표시이면 OS/브라우저 알림 설정(Windows Focus Assist, Chrome 사이트 권한, 조용한 알림 UI)을 우선 점검

---

## <a id="20260224-6"></a> 2026-02-24 | 대시보드 상단 웹 알림 설정 버튼 추가

**Commit**: `working tree`
**작업 내용**:
- 관리자 대시보드 헤더(`대시보드 / FC 온보딩 전체 현황판`) 우측 버튼 영역에 `알림 설정` 버튼 추가
- 기존 `새로고침` 버튼 왼쪽에 배치하여 운영자가 현재 화면에서 바로 웹푸시 권한 요청/재등록 가능하도록 개선
- 버튼 클릭 시 `registerWebPushSubscription(role, residentId, { forceResubscribe: true })` 실행:
  - 성공: 등록 완료 알림
  - 브라우저 미지원/권한 거부/기타 실패: 상황별 안내 알림
- 관리자 흐름과 동일한 shared web-push 헬퍼를 재사용하여 설정 페이지와 동작 일관성 유지

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/dashboard/page.tsx` 통과
- Vercel production 배포 완료:
  - `https://admin-q7k45zhrs-jun-jeongs-projects.vercel.app`
  - alias: `https://adminweb-red.vercel.app`

**다음 단계**:
- 웹 프로덕션 배포 후 대시보드 상단 `알림 설정` 버튼 노출 확인
- 버튼 클릭 후 FC 앱 메시지 전송 시 총무 브라우저 알림 수신 확인

---

## <a id="20260224-5"></a> 2026-02-24 | 설정 페이지 웹 알림 권한 버튼/상태 UI 추가

**Commit**: `working tree`
**작업 내용**:
- 웹 설정 페이지(`dashboard/settings`)에 웹푸시 상태/권한 제어 UI 추가:
  - 상태 표시: `granted`, `denied`, `default`, `unsupported`
  - 버튼 액션: 권한 요청 + 웹푸시 구독 강제 재등록(`forceResubscribe`)
  - 권한 거부(`denied`) 시 브라우저 사이트 설정 안내 메시지 제공
- `WebPushRegistrar` 리팩터링:
  - `getWebPushPermissionState()`
  - `registerWebPushSubscription(role, residentId, opts)`
  - 자동 등록(`useEffect`)과 수동 버튼 액션에서 동일 함수 재사용
- 구독 API 실패 시 에러 메시지를 반환해 설정 화면에서 사용자 피드백 노출

**핵심 파일**:
- `web/src/components/WebPushRegistrar.tsx`
- `web/src/app/dashboard/settings/page.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/components/WebPushRegistrar.tsx src/app/dashboard/settings/page.tsx` 통과
- Vercel production 배포 완료:
  - `https://admin-nbmu1fo8i-jun-jeongs-projects.vercel.app`
  - alias: `https://adminweb-red.vercel.app`

**다음 단계**:
- 총무 계정으로 `설정 > 웹 알림` 버튼 클릭 후 권한 허용/재등록
- FC 앱에서 메시지 전송하여 총무 브라우저 백그라운드 알림 수신 확인

---

## <a id="20260224-4"></a> 2026-02-24 | 총무 웹푸시 미수신 복구(운영 반영 완료)

**Commit**: `working tree`
**작업 내용**:
- 원인 확정:
  - `/api/admin/push`가 401을 반환했지만 헤더 자체는 도달하고 있었음
  - 실측 디버그 결과 `hasSecret/hasBearer/hasApikey=true` + `secretConfigured/serviceRoleConfigured=true` 상태에서 비교만 실패
  - 결론: auth 토큰 비교 시 env/헤더 포맷 오염(개행/literal `\\n`/따옴표)으로 문자열 불일치
- 서버 수정:
  - `web/src/app/api/admin/push/route.ts`
    - `normalizeToken()` 추가 (trim + quote 제거 + literal `\\n` 제거 + 개행 제거)
    - `X-Admin-Push-Secret`, Bearer, apikey, env secret/service key 모두 정규화 후 비교
  - `web/src/lib/web-push.ts`
    - VAPID env 정규화/검증 강화(공백/개행/literal `\\n` 제거, invalid config 명시 로그)
- 운영 반영:
  - Vercel production env 강제 overwrite:
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - `ADMIN_PUSH_SECRET`
    - `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`
    - `WEB_PUSH_VAPID_PRIVATE_KEY`
    - `WEB_PUSH_SUBJECT`
  - Vercel production 재배포 완료:
    - `https://admin-c87og339h-jun-jeongs-projects.vercel.app`
    - alias: `https://adminweb-red.vercel.app`

**핵심 파일**:
- `web/src/app/api/admin/push/route.ts`
- `web/src/lib/web-push.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/api/admin/push/route.ts src/lib/web-push.ts` 통과
- 실서비스 엔드포인트 검증:
  - `POST https://adminweb-red.vercel.app/api/admin/push`
  - Bearer+apikey 인증: `200 {"ok":true,"sent":1,"failed":0}`
  - `X-Admin-Push-Secret` 인증: `200 {"ok":true,"sent":1,"failed":0}`
- `fc-notify` 직접 invoke:
  - `200` 응답 + admin 대상 notifications row insert 확인

**다음 단계**:
- 실제 FC 앱에서 총무로 채팅 메시지 전송 후, 구독된 총무 브라우저(같은 프로필/권한 허용 상태)에서 백그라운드 알림 수신 최종 확인

---

## <a id="20260224-3"></a> 2026-02-24 | 웹푸시 VAPID env 포맷 오류 방어 추가

**Commit**: `working tree`
**작업 내용**:
- `web/src/lib/web-push.ts`에 웹푸시 env 정규화 로직 추가:
  - 따옴표/공백/개행 및 literal `\\n` 제거
  - VAPID 공개키/비공개키는 내부 공백 제거까지 수행
- VAPID 설정 실패 시 `webpush.setVapidDetails` 예외를 잡아 명시 로그(`invalid VAPID configuration`)를 남기고 안전하게 비활성 처리
- 필수 VAPID env 누락 시 경고 로그 추가(`missing VAPID configuration`)
- 배경: 실제 진단 중 local env의 VAPID 키 끝에 literal `\\n`이 포함되어 web-push 키 검증 실패 재현됨

**핵심 파일**:
- `web/src/lib/web-push.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/lib/web-push.ts src/app/api/admin/push/route.ts` 통과

**다음 단계**:
- Next.js 웹 런타임 재배포
- Vercel 환경변수의 `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`에 불필요한 `\\n`/공백이 없는지 확인

---

## <a id="20260224-2"></a> 2026-02-24 | 앱→총무 채팅 웹푸시 누락 대응(콜백 신뢰성 보강)

**Commit**: `working tree`
**작업 내용**:
- `supabase/functions/fc-notify/index.ts`의 어드민 웹푸시 콜백 로직 보강:
  - `ADMIN_WEB_URL`에 경로가 포함되어 있어도 origin 기준으로 `/api/admin/push`를 강제 조합하도록 정규화
  - 콜백 요청 헤더에 `Authorization: Bearer <service-role>` + `apikey`를 추가해 `ADMIN_PUSH_SECRET` 드리프트 상황에서도 인증 fallback 가능
  - 401/404/500 등 non-2xx 응답 본문을 함수 로그에 남기도록 개선해 운영 가시성 강화
  - `ADMIN_WEB_URL` 누락/형식 오류 시 조기 경고 로그 추가
- `web/src/app/api/admin/push/route.ts` 인증 보강:
  - 기존 `X-Admin-Push-Secret` 단일 검증에서
    `X-Admin-Push-Secret` 또는 `Authorization Bearer(service-role key)` 둘 중 하나 통과 시 허용하도록 확장
  - 인증 실패 시 `hasSecret/hasBearer/secretConfigured` 메타 로그를 남겨 원인 파악 단축
- 운영 진단:
  - 로컬 `web/.env.local` 기준 푸시/시크릿 키 존재 여부를 재점검해 누락 가능성을 제거
  - 콜백 non-2xx 응답을 로그로 노출하도록 변경해 401/404 류의 미표시 실패를 운영에서 즉시 확인 가능하게 개선

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `web/src/app/api/admin/push/route.ts`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint -- src/app/api/admin/push/route.ts` 통과
- `supabase functions deploy fc-notify --project-ref ubeginyxaotcamuqpmud` 완료 (버전 48 반영 확인)
- `deno` 실행기가 로컬에 없어 Edge Function 포맷/린트 커맨드는 미실행

**다음 단계**:
- 배포된 Next.js 환경의 `ADMIN_PUSH_SECRET`와 Supabase `ADMIN_PUSH_SECRET` 동기화 확인
- FC 앱에서 총무 채팅 메시지 전송 후 브라우저 백그라운드 알림 재검증

---

## <a id="20260224-1"></a> 2026-02-24 | 어드민 브라우저 웹 푸시 알림 추가

**Commit**: `475f11b`
**작업 내용**:
- `web/src/app/api/admin/push/route.ts` 신규 생성:
  - `X-Admin-Push-Secret` 헤더로 인증하는 보호 엔드포인트
  - `web_push_subscriptions` 테이블에서 `role='admin'` 구독자 조회 후 `sendWebPush` 발송
  - 만료 구독 자동 정리
- `supabase/functions/fc-notify/index.ts` 수정:
  - `notifyAdminWebPush(title, body, url)` 헬퍼 추가
  - `type='notify'`+`target_role='admin'`, `type='message'`+`target_role='admin'`, `type='fc_update'`, `type='fc_delete'` 처리 후 어드민 웹 푸시 콜백 호출
- `web/src/app/api/fc-notify/route.ts` 수정:
  - `type='notify'`+`target_role='admin'` 케이스에 웹 푸시 처리 추가
- `web/src/app/api/web-push/subscribe/route.ts` 수정:
  - anon 클라이언트 → service role 클라이언트로 교체
  - 커스텀 인증 환경에서 `auth.uid()=null`로 인한 RLS 차단 버그 수정
- Supabase 시크릿 등록: `ADMIN_PUSH_SECRET`, `ADMIN_WEB_URL`
- Vercel 환경변수 등록: `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, `ADMIN_PUSH_SECRET`
- `fc-notify` Edge Function 배포 완료

**핵심 파일**:
- `web/src/app/api/admin/push/route.ts` (신규)
- `supabase/functions/fc-notify/index.ts`
- `web/src/app/api/fc-notify/route.ts`
- `web/src/app/api/web-push/subscribe/route.ts`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `cd web && npm run lint` 통과
- Vercel 빌드 통과 (notifications edit 페이지 누락 파일 추가 커밋 포함)

**다음 단계**:
- 어드민이 `adminweb-red.vercel.app` 접속 후 브라우저 알림 권한 허용 필요
- FC 채팅/서류/동의/시험 신청 시 OS 알림 수신 확인

---

## <a id="20260220-1"></a> 2026-02-20 | 모바일 시험 신청(생명/손해) 마감 필터 기준 통일 및 당겨서 새로고침 제스처 복구

**Commit**: `0c25c96`  
**작업 내용**:
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`의 시험 일정 조회 기준을 동일화:
  - `registration_deadline`이 최근 7일 이내인 일정만 조회되도록 통일
  - cutoff 비교 포맷을 `YYYY-MM-DD`로 정렬해 화면 간 날짜 비교 일관성 확보
- 두 화면 모두 새로고침 UX를 동일화:
  - 당겨서 새로고침/헤더 새로고침 버튼이 모두 `round list + my applications + profile allowance state`를 함께 갱신하도록 변경
- 새로고침 제스처 미동작 원인(중첩 스크롤 구조) 제거:
  - `KeyboardAwareWrapper` 내부의 중첩 `ScrollView`를 제거하고, `RefreshControl`을 wrapper에 직접 연결해 단일 스크롤 소유 구조로 수정
- 관련 진행 이력을 `AGENTS.md` Progress Ledger에 추가

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `npm run lint -- app/exam-apply.tsx app/exam-apply2.tsx` 통과
- 실제 기기 확인 기준: 생명/손해 시험 신청 화면에서 pull-to-refresh 제스처 정상 동작 및 상단 새로고침 버튼과 동일한 데이터 갱신 경로 사용

---

## <a id="20260219-8"></a> 2026-02-19 | 웹 대시보드 서류 배지의 "검토 중" 카운트를 제출 문서 기준으로 보정

**작업 내용**:
- 관리자 웹 대시보드 FC 카드의 서류 요약 배지에서 `검토 중` 카운트 조건을 조정
- 기존에는 `approved/rejected`가 아닌 모든 문서를 카운트해 미제출 문서도 포함되던 문제를 수정
- 이제 `storage_path`가 존재하고 `deleted`가 아닌 제출 문서 중, `approved/rejected`가 아닌 문서만 `검토 중`에 집계

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

**검증**:
- `cd web && npm run lint` 통과

---

## <a id="20260219-7"></a> 2026-02-19 | 웹 FC 상세 페이지에서 프로필/관리자 메모 수정 경로를 서버 API로 전환하고 관리자만 수정 가능하도록 권한 제어 보강

**작업 내용**:
- FC 상세 페이지(`web/src/app/dashboard/profile/[id]/page.tsx`)의 프로필 저장/메모 저장 로직에서 클라이언트 직접 `supabase.from('fc_profiles').update(...)` 호출을 제거
- `/api/admin/fc`의 `updateProfile` 액션을 사용하도록 변경해 관리자 쓰기 경로를 서버 중계 경로로 통일
- `useSession` 기반 권한 상태(`role`, `isReadOnly`)를 반영해 관리자(admin)만 수정 가능하도록 버튼/입력 상태를 제어하고, manager 계정에서는 읽기 전용 동작을 명시적으로 유지
- 저장 후 `fc-profile` 쿼리 invalidate를 통해 화면 반영을 안정화

**핵심 파일**:
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `AGENTS.md`

**검증**:
- `cd web && npm run lint` 통과

---

## <a id="20260219-6"></a> 2026-02-19 | 주민번호 표기 경로 전반에서 마스킹 fallback 제거 및 관리자 화면 전체번호 조회 확장

**작업 내용**:
- 주민번호 전체 조회 액션(`admin-action:getResidentNumbers`)의 내부 전용 제약을 해제해 관리자 모바일 화면에서도 동일 액션을 사용 가능하도록 조정
- 웹 신청자/프로필 화면의 주민번호 표시 fallback에서 `resident_id_masked` 사용을 제거하고, 원문 조회 실패 시 `-`로 처리하도록 정리
- 모바일 관리자 시험 신청자 화면(`exam-manage`, `exam-manage2`)에 주민번호 원문 조회(`getResidentNumbers`)를 연결
- FC 기본정보 화면(`fc/new`)의 기존 마스킹 문자열 노출을 제거하고, 관리자 세션에서는 원문 조회 시 원문 표시하도록 보강

**핵심 파일**:
- `supabase/functions/admin-action/index.ts`
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `app/exam-manage.tsx`
- `app/exam-manage2.tsx`
- `app/fc/new.tsx`

**검증**:
- `npm run lint` (mobile) 통과
- `cd web && npm run lint` 통과

---

## <a id="20260219-5"></a> 2026-02-19 | WORK_LOG 최근 작업 행수 제한 제거(정책/CI 동기화)

**작업 내용**:
- 문서 정책에서 `WORK_LOG` 최근 작업 테이블의 행수 상한(30행) 규칙을 제거
- CI 거버넌스 검사(`check-governance.mjs`)에서 최근 작업 행수 초과 실패 검사를 제거
- 연동 문서 표현을 상한 기준에서 "최신 항목 상단 정렬 유지" 기준으로 정리

**핵심 파일**:
- `AGENTS.md`
- `.claude/PROJECT_GUIDE.md`
- `.claude/WORK_LOG.md`
- `scripts/ci/check-governance.mjs`

**검증**:
- `node scripts/ci/check-governance.mjs` 통과
- `WORK_LOG` ↔ `WORK_DETAIL` 앵커 링크 규칙 유지 확인

---

## <a id="20260219-4"></a> 2026-02-19 | 관리자 웹 서류 탭에서 미제출 항목 노출 필터 보정

**작업 내용**:
- 관리자 웹 대시보드의 FC 상세 > 서류 탭에서 `제출된 서류` 집계/목록 필터가
  `storage_path !== 'deleted'`만 검사하던 조건을 수정
- `storage_path`가 실제로 존재하는(업로드된) 항목만 `제출된 서류`에 노출되도록 보정
- 결과적으로 미제출 항목(빈 `storage_path`)은 `제출된 서류` 영역에서 제외됨

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

**검증**:
- `cd web && npm run lint` 통과
- 제출된 서류 count/list 조건이 동일 필터(`storage_path && storage_path !== 'deleted'`)로 정렬된 것 확인

---

## <a id="20260219-3"></a> 2026-02-19 | 웹 FC 상세에서 관리자 주민번호 원문 조회 표시 연동

**작업 내용**:
- 웹 FC 상세 페이지에서 `resident_id_masked`만 표시하던 로직을 보완해, 관리자 권한일 때 서버 API(`/api/admin/resident-numbers`)를 통해 주민번호 원문을 조회하도록 변경
- 주민번호 원문 조회 실패 또는 관리자 권한이 아닌 경우에는 기존 마스킹값으로 자동 fallback하도록 유지
- 생년월일 표시도 동일한 표시값(원문 우선, 실패 시 마스킹) 기준으로 계산되도록 정렬

**핵심 파일**:
- `web/src/app/dashboard/profile/[id]/page.tsx`

**검증**:
- `cd web && npm run lint` 통과
- 관리자 전용 주민번호 조회 경로를 기존 서버-중계 API 기반으로 사용해 보안 경로 유지 확인

---

## <a id="20260219-2"></a> 2026-02-19 | 수당동의 임시사번 선검증 및 계정 중복 차단 강화

**작업 내용**:
- 수당 동의 입력 시 임시사번(`temp_id`)이 없는 FC를 서버/클라이언트에서 선차단하도록 보강:
  - `fc-consent`에서 `temp_id`를 조회하고 미발급 시 실패 응답 반환
  - 모바일 `app/consent.tsx` 제출 전 임시사번 존재 여부를 확인하고 안내 알림 후 중단
- 비밀번호 설정 시 전화번호 중복 계정 차단 강화:
  - `set-password`에서 `admin_accounts`, `manager_accounts` 중복을 선검사해 FC 계정 생성 차단
- 웹 프로필 페이지 effect 의존성 경고를 정리해 폼 초기화 동작을 안정화
- Supabase Edge Functions용 Deno import map 파일(`supabase/functions/deno.json`) 추가 및 IDE Deno 설정 반영

**핵심 파일**:
- `app/consent.tsx`
- `supabase/functions/fc-consent/index.ts`
- `supabase/functions/set-password/index.ts`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `supabase/functions/deno.json`
- `.vscode/settings.json`
- `.claude/settings.json`

**검증**:
- 변경 파일 diff 검토로 수당 동의 선검증/중복 차단 로직 반영 확인
- 문서 거버넌스 규칙(`WORK_LOG` + `WORK_DETAIL` 동시 갱신) 충족 확인

---

## <a id="20260219-1"></a> 2026-02-19 | 회원가입 사전 중복검증/홈 플로우 안정화 및 AGENTS 거버넌스 문서 추가

**Commit**: `46d7a59`  
**작업 내용**:
- 회원가입 시작 단계에서 OTP 발송 전 번호 중복 여부를 사전 확인하도록 보강:
  - `request-signup-otp`에 `checkOnly` 모드 추가
  - FC/총무/본부장 전화번호 중복을 서버에서 일괄 판정
  - 이미 가입된 번호는 `ok: false`와 안내 메시지로 반환
- 앱 가입 화면에서 `checkOnly` 호출을 사용해 중복 번호를 조기 차단하고, 확인 중 버튼 비활성화 처리 추가
- 신원정보 저장 이후 홈 진입 단계 계산이 즉시 갱신되도록 `my-fc-status` 쿼리 invalidate/refetch 추가
- Android 홈 화면 뒤로가기 시 앱 종료 확인 다이얼로그 추가 (`app/index.tsx`, `app/home-lite.tsx`)
- 루트/하위 `AGENTS.md` 문서군 및 `AGENT.md`를 추가해 모듈별 컨텍스트 라우팅 문서 체계 정리

**핵심 파일**:
- `app/signup.tsx`
- `supabase/functions/request-signup-otp/index.ts`
- `app/identity.tsx`
- `app/index.tsx`
- `app/home-lite.tsx`
- `app/_layout.tsx`
- `AGENT.md`
- `AGENTS.md`
- `app/AGENTS.md`
- `components/AGENTS.md`
- `hooks/AGENTS.md`
- `web/AGENTS.md`
- `supabase/AGENTS.md`
- `supabase/functions/AGENTS.md`

**검증**:
- 커밋 기준 코드/문서 diff 검토
- 거버넌스 조건(코드 변경 시 `WORK_LOG` + `WORK_DETAIL` 동시 갱신) 충족 확인

---

## <a id="20260211-15"></a> 2026-02-11 | Android 릴리즈 난독화/리소스 축소 설정 반영

**작업 내용**:
- `expo-build-properties`의 Android 릴리즈 옵션에 아래 값을 추가:
  - `enableMinifyInReleaseBuilds: true`
  - `enableShrinkResourcesInReleaseBuilds: true`
- 목적:
  - 릴리즈 AAB에서 R8 난독화/코드 최적화 활성화
  - 리소스 축소로 앱 크기 감소
  - Play Console의 deobfuscation 관련 경고 원인(난독화 미설정 상태) 해소 기반 마련

**핵심 파일**:
- `app.json`

**검증**:
- `npx expo config --type public --json` 성공

---

## <a id="20260211-16"></a> 2026-02-11 | iOS 빌드 번들ID 등록 실패(Apple Maintenance) 대응

**작업 내용**:
- `eas build` 실패 로그의 HTML 본문(`Maintenance - Apple Developer`) 기준으로 Apple Developer 포털 점검 응답을 원인으로 확인
- Git/EAS 로컬 환경 점검:
  - `eas --version`을 `16.32.0`으로 업데이트
  - `eas whoami`로 계정 인증 상태 확인(`jj8127`)
- 운영 문서 보강:
  - Apple 점검 시 우회 빌드 커맨드(`--non-interactive --freeze-credentials`)와 재설정 순서를 명령어 문서에 추가

**핵심 파일**:
- `docs/guides/명령어 모음집.txt`

**검증**:
- `Invoke-WebRequest https://developer.apple.com/maintenance/` 결과에서 maintenance 문구 확인
- `eas --version` 결과 `16.32.0` 확인

---

## <a id="20260211-14"></a> 2026-02-11 | 정책/보안 정리(B): 로컬 산출물/설정 추적 해제

**작업 내용**:
- 정책 불일치 정리:
  - 추적 중이던 `testsprite_tests/` 산출물 삭제(이미 `.gitignore` 대상)
  - 고아 gitlink 상태의 `Claude-Code-Usage-Monitor` 제거
- 보안/로컬 설정 정리:
  - 민감값이 포함될 수 있는 `.codex/config.toml`, `.codex/mcp.json` 추적 제거
  - `.gitignore`에 `.codex/`, `Claude-Code-Usage-Monitor/` 추가

**핵심 파일**:
- `.gitignore`
- `.codex/config.toml` (삭제)
- `.codex/mcp.json` (삭제)
- `testsprite_tests/*` (삭제)
- `Claude-Code-Usage-Monitor` (gitlink 삭제)

---

## <a id="20260211-13"></a> 2026-02-11 | 안전 묶음(A): 빌드 산출물/미사용 모듈 정리

**작업 내용**:
- 빌드 산출물 정리:
  - `dist-web-new2/` 전체 삭제
  - 재추적 방지를 위해 `.gitignore`에 `dist-web/`, `dist-web-new2/` 추가
- 미사용 코드/자산 정리:
  - 미사용 라우트/모듈 삭제:
    - `app/admin-register.tsx`
    - `components/LoginForm.tsx`, `components/ImageTourGuide.tsx`
    - `components/BoardCard.tsx`, `components/EmptyState.tsx`
    - `components/external-link.tsx`, `components/haptic-tab.tsx`, `components/hello-wave.tsx`
    - `components/ui/icon-symbol.tsx`, `components/ui/icon-symbol.ios.tsx`
    - `hooks/use-dashboard-data.ts`, `hooks/use-theme-color.ts`
    - `constants/theme.ts`, `lib/docRules.ts`
  - 미사용 자산 삭제:
    - `assets/guide/shortcuts-guide.jpg`
    - `assets/guide/shortcuts-guide.png`
    - `agreement_imag/00.jpg`

**검증**:
- `npm run lint` (mobile) 통과
- `npx tsc --noEmit` (mobile) 통과
- `npm test -- --runInBand` 통과
- `npm run lint` (web) 통과
- `npm run build` (web) 통과

---

## <a id="20260211-12"></a> 2026-02-11 | 앱/웹 미점검 영역 종합 점검 및 안정화 패치

**작업 내용**:
- 모바일/웹 전체 정적 검사 및 테스트 실행:
  - 모바일 `expo lint`, `tsc --noEmit`, `jest --runInBand`
  - 웹 `eslint`, `next build`, `tsc --noEmit`
- 실결함 보정:
  - `app/_layout.tsx`에서 누락된 `safeStorage` import 추가(런타임 참조 안정화)
  - `useIdentityGate`의 잘못된 경로(`'/auth'`)를 실제 로그인 경로(`'/login'`)로 수정
  - Jest가 `web/.next`를 스캔해 실패하던 문제를 ignore 패턴으로 차단
  - 홈 가이드 시작 안정화: 메인/바로가기 가이드 상호 정지 후 `start(1)` 명시 시작 + 재시도 타이밍 보강
- 품질 경고 정리(동작 변경 없는 리팩터링):
  - 미사용 변수/임포트 제거
  - Hook dependency 누락 경고 정리
  - 웹 채팅 메시지 로딩 effect 의존성 정합성 보강
  - 웹 공지 상세 이미지 렌더링 경고(`no-img-element`) 해소

**핵심 파일**:
- `app/_layout.tsx`
- `hooks/use-identity-gate.ts`
- `jest.config.js`
- `app/consent.tsx`
- `app/index.tsx`
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `app/fc/new.tsx`
- `components/BoardCard.tsx`
- `components/EmptyState.tsx`
- `components/LoadingSkeleton.tsx`
- `components/Toast.tsx`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`

**검증**:
- `npm run lint` (mobile) 통과
- `npx tsc --noEmit` (mobile) 통과
- `npm test -- --runInBand` 통과 (2 suites, 53 tests)
- `npm run lint` (web) 통과
- `npm run build` (web) 통과
- `npx tsc --noEmit` (web) 통과

---

## <a id="20260211-11"></a> 2026-02-11 | 문서 거버넌스 CI/PR 강제 및 SSOT 정리

**작업 내용**:
- `.github/workflows/governance-check.yml` 추가로 문서/스키마 규칙 자동 검사 도입
- PR 본문 체크리스트 미충족 시 실패하도록 `scripts/ci/check-pr-template.mjs` 추가
- 코드 변경 시 `WORK_LOG` + `WORK_DETAIL` 동시 갱신 여부를 검사하는 `scripts/ci/check-governance.mjs` 추가
- `PROJECT_GUIDE.md`에 문서 SSOT 역할 분리와 자동 검증 규칙 명시

**핵심 파일**:
- `.github/workflows/governance-check.yml`
- `.github/pull_request_template.md`
- `scripts/ci/check-governance.mjs`
- `scripts/ci/check-pr-template.mjs`
- `.claude/PROJECT_GUIDE.md`

---

## <a id="20260211-10"></a> 2026-02-11 | 시험 접수 마감 기준을 당일 23:59:59로 변경

**작업 내용**:
- FC 시험 신청 화면(생명/손해)에서 마감 판정 기준을 `마감일 18:00`에서 `마감일 23:59:59`로 수정
- 웹 시험 일정 화면의 `(마감)` 표시 판정도 동일 기준(`endOf('day')`)으로 통일
- 결과적으로 `마감일=19일` 설정 시 `20일 00:00`부터 마감 처리되도록 보정

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `web/src/app/dashboard/exam/schedule/page.tsx`

---

## <a id="20260211-9"></a> 2026-02-11 | 서류 마감일(18:00 기준) 알림 로직 정합성 보정

**작업 내용**:
- `docs-deadline-reminder` 조회 범위를 `D-1 ~ D+3`로 조정하여 사전 리마인드가 가능하도록 보정
- 마감 문구를 분기형(D-3/D-1/D-day/마감 경과)으로 교체
- 마감 기준 시각을 `마감일 18:00(KST)`로 반영 (`DEADLINE_HOUR_KST = 18`)
- `notifications` insert 시 `target_url` 컬럼 불일치(42703) fallback 처리 추가
- 서류 요청 업데이트 시 `fc_profiles` 업데이트 에러 누락 구간 보강

**핵심 파일**:
- `supabase/functions/docs-deadline-reminder/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/api/admin/fc/route.ts`

---

## <a id="20260211-8"></a> 2026-02-11 | 임시번호 발급 알림 탭 시 수당 동의 페이지 이동 보정

**작업 내용**:
- 알림센터 라우팅 fallback에서 `임시번호/임시사번` 키워드 분기를 추가
- `target_url`이 없거나 기존 알림 데이터여도, 해당 알림 탭 시 `/consent`로 이동하도록 보정

**핵심 파일**:
- `app/notifications.tsx`

---

## <a id="20260211-7"></a> 2026-02-11 | 알림센터 저장 누락(푸시만 수신) 대응

**작업 내용**:
- 증상: 푸시 알림은 도착하지만 알림센터(`notifications` 테이블) 저장이 누락됨
- 원인: 일부 경로에서 `target_url` 컬럼 포함 insert 실패 시 로그만 남기고 계속 진행
- 대응:
  - `fc-notify`에 `notifications` insert fallback 추가 (`target_url` 실패 시 컬럼 제외 재시도)
  - `admin-action`의 `sendNotification` 경로에도 동일 fallback 추가
  - 웹 관리자 `sendPushNotification` 및 관리자 채팅 알림 insert에 fallback 추가
  - `fc-notify`, `admin-action` Edge Function 재배포 완료
- 검증:
  - `fc-notify notify(target_id=00000000000)` 호출 후 `inbox_list`에서 저장 레코드 확인

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/actions.ts`
- `web/src/app/dashboard/chat/page.tsx`

---

## <a id="20260211-6"></a> 2026-02-11 | FC 사전등록 안내 화면 임시 공지/알림 섹션 제거

**작업 내용**:
- 사용자 요청에 따라 `apply-gate` 화면에 추가했던 `먼저 확인해보세요` 블록(공지사항/알림센터 버튼)을 제거
- 기존 등록 신청 안내 및 기본 버튼(나중에/등록 신청 시작)만 유지

**핵심 파일**:
- `app/apply-gate.tsx`

---

## <a id="20260211-5"></a> 2026-02-11 | FC 사전등록 공지/알림 접근 개선 및 CORS 기본값 보정

**작업 내용**:
- FC 사전등록 안내 화면(`apply-gate`)에서 공지/알림센터로 즉시 이동 가능한 버튼 추가
- `home-lite` 바로가기 영역에서 불필요한 3번째 카드(알림센터 카드) 제거 요청 반영
- `fc-notify` Edge Function CORS 기본 `Access-Control-Allow-Origin` 값을 `*`로 보정하여, `ALLOWED_ORIGINS` 미설정 환경에서 공지/알림 조회 실패 가능성 완화

**핵심 파일**:
- `app/apply-gate.tsx`
- `app/home-lite.tsx`
- `supabase/functions/fc-notify/index.ts`

---

## <a id="20260211-1"></a> 2026-02-11 | 웹 공지 상세 페이지 및 목록 행 클릭 이동 구현

**Commit**: `778d48e`  
**작업 내용**:
- 관리자 웹 공지 목록에서 행 클릭 시 상세 페이지로 이동하도록 라우팅 개선
- 공지 상세 페이지(`notifications/[id]`) 동선 정리
- 서버 API와 상세 뷰 연결 강화

**핵심 파일**:
- `web/src/app/dashboard/notifications/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`
- `web/src/app/api/admin/notices/route.ts`

---

## <a id="20260211-2"></a> 2026-02-11 | 웹 공지 조회를 서버 API 경유로 전환(RLS 우회)

**Commit**: `50586dc`  
**작업 내용**:
- 웹 공지 목록이 RLS 영향으로 비어 보이던 문제 해결
- 클라이언트 직접 조회 대신 서버 라우트 API를 통해 공지 목록 조회

**핵심 파일**:
- `web/src/app/api/admin/notices/route.ts`
- `web/src/app/dashboard/notifications/page.tsx`

---

## <a id="20260211-3"></a> 2026-02-11 | 앱 공지 페이지를 fc-notify 기반 조회로 전환

**Commit**: `0074887`  
**작업 내용**:
- 모바일 공지 페이지에서 Supabase 직접 조회 대신 `fc-notify`(`inbox_list`) 응답 기반으로 전환
- RLS 환경에서도 공지/알림센터 데이터가 보이도록 안정화

**핵심 파일**:
- `app/notice.tsx`
- `supabase/functions/fc-notify/index.ts`

---

## <a id="20260211-4"></a> 2026-02-11 | 계정 삭제 플로우 실패 대비(fail-safe) 보강

**Commit**: `ca34a72`  
**작업 내용**:
- 앱 설정의 계정 삭제 로직이 특정 경로 실패 시 중단되던 문제 보완
- 대시보드/설정/Edge Function 삭제 경로를 보강해 삭제 복구 가능성 향상

**핵심 파일**:
- `app/settings.tsx`
- `app/dashboard.tsx`
- `supabase/functions/delete-account/index.ts`

---

## <a id="20260210-1"></a> 2026-02-10 | Windows 환경 Next.js dev lockfile 충돌 완화

**Commits**: `93f1336`, `05d3aec`  
**작업 내용**:
- Windows에서 `.next` lockfile/권한 충돌로 dev/build가 막히는 문제 완화
- dev 시작 전 프로세스 정리 및 안전한 클린업 스크립트 추가

**핵심 파일**:
- `web/package.json`
- `web/scripts/clean-next.mjs`
- `web/scripts/kill-next-dev.mjs`

---

## <a id="20260210-2"></a> 2026-02-10 | 웹 세션 쿠키 동기화 및 재로드 후 API 인증 안정화

**Commits**: `91fc04c`, `bdaa8eb`, `b462f4c`  
**작업 내용**:
- 웹 세션 복원 시 쿠키 동기화가 누락되어 관리자 API가 실패하던 문제 수정
- 세션 하이드레이션 이후 주민번호 조회 등 민감 API를 지연/조건부 호출

**핵심 파일**:
- `web/src/hooks/use-session.tsx`
- `web/src/app/dashboard/exam/applicants/page.tsx`

---

## <a id="20260210-3"></a> 2026-02-10 | 시험 신청자 화면 UX/타입/주민번호 표시 개선

**Commits**: `70d61de`, `18ea173`, `02a7d12`, `cb63c19`, `d4eeb52`, `1cdb808`  
**작업 내용**:
- 신청자 테이블 가로 스크롤 및 컬럼 폭 조정
- 주민등록번호 표시 컬럼 정합성 개선
- `no-explicit-any` 대응 등 타입 안정성 개선

**핵심 파일**:
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/api/admin/resident-numbers/route.ts`
- `web/src/app/api/admin/fc/route.ts`

---

## <a id="20260210-4"></a> 2026-02-10 | 시험 일정/신청 도메인 null 날짜 처리 및 연계 안정화

**Commits**: `d674396`, `554342c`, `12e2625`  
**작업 내용**:
- `exam_date`가 `null`(미정)일 때 `Invalid Date`/`1970-01-01` 노출 문제 대응
- 시험 과목/라벨 표시 로직 정리
- 앱/웹/함수/스키마 동시 보정으로 일정 등록-조회 흐름 안정화

**핵심 파일**:
- `types/exam.ts`
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`
- `web/src/app/dashboard/exam/schedule/actions.ts`
- `supabase/functions/admin-action/index.ts`
- `supabase/schema.sql`

---

## <a id="20260210-5"></a> 2026-02-10 | 대시보드 사이드바 토글/호버 확장 UX 도입

**Commits**: `e47da92`, `9957364`  
**작업 내용**:
- 사이드바를 버튼 기반 토글에서 호버 확장 UX까지 확장
- 좌측 네비게이션 가시성/작업 동선 개선

**핵심 파일**:
- `web/src/app/dashboard/layout.tsx`

---

## <a id="20260209-1"></a> 2026-02-09 | 앱/웹 누적 미반영 수정 일괄 반영 및 정리

**Commit**: `94a3fe6`  
**작업 내용**:
- 대시보드, 시험, 알림센터, 문서/회원가입 등 다수 화면/함수 정리
- 앱/웹 종단 간 누적 이슈를 하나의 정리 커밋으로 반영

**핵심 파일(대표)**:
- `app/dashboard.tsx`, `app/notifications.tsx`, `app/index.tsx`
- `supabase/functions/admin-action/index.ts`, `supabase/functions/fc-notify/index.ts`
- `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/exam/schedule/*`

---

## <a id="20260205-1"></a> 2026-02-05 | 온보딩 플로우 및 관리자 대시보드 대규모 업데이트

**Commit**: `904f020`  
**작업 내용**:
- 앱 온보딩 흐름(로그인/가입/수당/서류/위촉) 및 관리자 도메인 로직 동시 업데이트
- 스키마/함수/웹 관리 페이지 연동 정비
- 문서(README/CLAUDE/COMMANDS) 갱신

**핵심 파일(대표)**:
- `app/*` 다수
- `supabase/functions/*` 일부
- `supabase/schema.sql`
- `web/src/app/dashboard/*` 다수

---

## <a id="20260205-2"></a> 2026-02-05 | 서비스 계정/앱 키 파일 Git 관리 정책 조정

**Commits**: `9a1338b`, `14f4040`, `629b29a`  
**작업 내용**:
- `google-services.json`의 추적/제외 정책을 빌드 상황에 맞게 조정
- 캐시/민감 파일 ignore 정책 정리

**핵심 파일**:
- `.gitignore`
- `google-services.json`

---

## <a id="20260129-1"></a> 2026-01-29 | 미등록 계정 로그인/재설정 처리 및 FC 삭제 개선

**Commit**: `75defa8`  
**작업 내용**:
- 등록되지 않은 계정의 로그인/비밀번호 재설정 UX 보강
- FC 삭제 API/대시보드 연계 개선

**핵심 파일**:
- `app/auth.tsx`, `app/reset-password.tsx`
- `hooks/use-login.ts`
- `supabase/functions/login-with-password/index.ts`
- `supabase/functions/request-password-reset/index.ts`
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260126-1"></a> 2026-01-26 | fc-delete API의 cookies 비동기 처리 보정

**Commit**: `23e4d8d`  
**작업 내용**:
- Next.js Route Handler에서 `cookies()` 사용 방식 보정
- 삭제 API 런타임 오류 방지

**핵심 파일**:
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260126-2"></a> 2026-01-26 | 동의/서류/일정/알림 액션 흐름 개선

**Commit**: `1d3b6b6`  
**작업 내용**:
- 수당 동의 및 대시보드 액션 관련 웹 서버 액션/알림 처리 보정
- 앱 홈/동의 플로우와 웹 액션의 상태 동기화 강화

**핵심 파일**:
- `app/consent.tsx`, `app/index.tsx`
- `supabase/functions/fc-consent/index.ts`
- `web/src/app/dashboard/*/actions.ts`

---

## <a id="20260126-3"></a> 2026-01-26 | 앱 브랜딩 자산 및 일부 대시보드/삭제 경로 조정

**Commit**: `faa61c1`  
**작업 내용**:
- 로그인/아이콘 자산 업데이트
- FC 삭제/대시보드 일부 경로 정리

**핵심 파일**:
- `app/login.tsx`
- `assets/images/*`
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260121-1"></a> 2026-01-21 | 모바일 게시판 홈 네비게이션 동선 조정

**Commit**: `c496aa7`  
**작업 내용**:
- 게시판 화면에서 홈/주요 경로 이동 UX 개선

**핵심 파일**:
- `app/board.tsx`

---

## <a id="20260121-2"></a> 2026-01-21 | Supabase Security Advisor 권고 반영

**Commit**: `09c9b30`  
**작업 내용**:
- RLS/뷰/함수 search_path 관련 보안 권고사항 반영
- 스키마와 마이그레이션 동시 정비

**핵심 파일**:
- `supabase/schema.sql`
- `supabase/migrations/20260121132500_enable_rls_and_view_security.sql`
- `supabase/migrations/20260121135000_fix_search_path_and_policies.sql`

---

## <a id="20260120-1"></a> 2026-01-20 | 하단 내비 컴포넌트 도입 및 설정 화면 정리

**Commit**: `fbb88d9`  
**작업 내용**:
- 모바일 공통 하단 내비게이션 컴포넌트 추가
- 설정/공지 화면 UI 정리 및 관련 컨텍스트 업데이트

**핵심 파일**:
- `components/BottomNavigation.tsx`
- `app/settings.tsx`, `app/notice.tsx`
- `hooks/use-bottom-nav-animation.ts`

---

## <a id="20260119-1"></a> 2026-01-19 | 게시판 화면 고도화 + Claude Skills/Subagent 체계 도입

**Commit**: `87276c6`  
**작업 내용**:
- 게시판 화면 개선
- `.claude/skills`, `.claude/agents` 문서/규칙 체계 구축

**핵심 파일**:
- `.claude/AGENTS_AND_SKILLS.md`
- `.claude/skills/*/SKILL.md`
- `.claude/agents/*.md`
- `app/board.tsx`

---

## <a id="20260117-1"></a> 2026-01-17 | 웹 빌드(TypeScript) 오류 수정

**Commit**: `785083f`  
**작업 내용**:
- Vercel 빌드를 막던 타입 오류 정리
- 관리자 웹 페이지 타입 안전성 보강

**핵심 파일**:
- `web/src/app/admin/exams/[id]/page.tsx`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`

---

## <a id="20260117-2"></a> 2026-01-17 | 게시판 기능(모바일/웹 + Edge Functions) 대규모 도입

**Commit**: `2f69ca4`  
**작업 내용**:
- 게시판 CRUD/댓글/반응/첨부 업로드/다운로드 기능 전면 도입
- 모바일/웹 UI 및 Edge Functions 세트 구축
- API 계약/요구사항/ADR/테마 컴포넌트 문서 업데이트

**핵심 파일(대표)**:
- `app/board.tsx`, `app/admin-board*.tsx`
- `supabase/functions/board-*`
- `lib/board-api.ts`, `web/src/lib/board-api.ts`
- `contracts/api-contracts.md`, `docs/guides/BOARD_REQUIREMENTS.md`

---

## <a id="20260113-1"></a> 2026-01-13 | 문서 최신화 및 Manager 읽기 전용 UI 보강

**Commit**: `f1448b6`  
**작업 내용**:
- 본부장(Manager) 계정 읽기 전용 표시/동작 추가 보정
- 대시보드/시험/채팅/공지 생성 화면 UX 문구 및 제어 정리

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`
- `web/src/app/dashboard/exam/*`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/components/StatusToggle.tsx`

---

## <a id="20260112-1"></a> 2026-01-12 | 공통 문서/컴포넌트/로거/개발도구 기반 구축

**Commit**: `0c95e8e`  
**작업 내용**:
- 프로젝트 문서 체계(`AI.md`, `HANDOVER.md`, `contracts`, `adr`) 정리
- 공통 UI 컴포넌트/로깅/검증/테스트/Git hooks 기반 확장
- 앱/웹/함수 전반 구조 정비

**핵심 파일(대표)**:
- `AI.md`, `HANDOVER.md`, `contracts/*`, `adr/*`
- `components/Button.tsx`, `components/FormInput.tsx`, `components/LoadingSkeleton.tsx`
- `lib/logger.ts`, `lib/validation.ts`
- `package.json`, `.husky/pre-commit`

---

## <a id="20260112-2"></a> 2026-01-12 | 웹 Manager 역할 처리 + 로그/빌드 호환성 + 시험일 미정 지원

**Commits**: `0cc1c4e`, `0689434`, `e4f944e`, `8b910e5`  
**작업 내용**:
- 웹 세션에 `manager` 역할 처리 및 읽기 전용 동작 반영
- logger의 Next.js 빌드 호환성 개선
- 시험 일정의 `TBD(미정)` 처리 지원

**핵심 파일**:
- `web/src/hooks/use-session.tsx`
- `web/src/app/auth/page.tsx`
- `web/src/app/dashboard/exam/schedule/page.tsx`
- `web/src/lib/logger.ts`

---

## <a id="20260112-3"></a> 2026-01-12 | 신원확인 입력 UX 및 명령어 문서 보강

**Commit**: `f0f46bb`  
**작업 내용**:
- 신원확인 입력 중 스크롤/키보드 충돌 완화
- 운영용 명령어 문서 보강

**핵심 파일**:
- `components/KeyboardAwareWrapper.tsx`
- `docs/guides/명령어 모음집.txt`

---

## <a id="20260112-4"></a> 2026-01-12 | 모바일 로그인 로고 반영

**Commit**: `f165d5a`  
**작업 내용**:
- 모바일 로그인 화면에 웹과 동일 브랜딩 로고 반영

**핵심 파일**:
- `app/login.tsx`

---

## <a id="20260112-5"></a> 2026-01-12 | 빌드 의존성 정렬 및 SMS 운영 문서 추가

**Commit**: `a0fbfcf`  
**작업 내용**:
- 빌드 의존성 정리
- SMS 테스트/운영 문서 및 스크립트 추가

**핵심 파일**:
- `package.json`, `package-lock.json`
- `docs/guides/COMMANDS.md`
- `docs/guides/SMS_TESTING.md`
- `test-sms.js`
