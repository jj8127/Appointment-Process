# Product Spec

## Task Summary
- Codex 자동화가 매일 오전 보험 관련 공개 웹자료를 검색/요약하고, 하루 1개의 가람in 게시판 digest를 자동 등록한다.
- repo에는 Codex가 만든 digest payload를 안전하게 `board-create`로 전달하는 작은 Node 운영 스크립트를 둔다.
- 파일럿은 schema 변경 없이 진행한다.

## User Outcomes
- FC/운영자는 가람in 게시판 `보험소식`에서 매일 보험소식 브리핑을 확인한다.
- 자동 게시도 기존 게시판 글과 같은 알림함/푸시 fanout 경로를 탄다.
- 홈 최신 공지 카드에도 최신 `보험소식` 브리핑이 노출되고, 탭하면 게시글 상세 화면으로 이동한다.
- 같은 날짜에 자동 브리핑이 중복 게시되지 않는다.

## Implementation Shape
- `scripts/ops/post-insurance-digest.mjs`
  - CLI 입력: `--input-json`, `--input-file`, `--title`, `--content`, `--source-url`, `--dry-run`
  - Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BOARD_AUTOMATION_ACTOR_ROLE=admin`, `BOARD_AUTOMATION_ACTOR_PHONE`, `BOARD_AUTOMATION_ACTOR_NAME`
  - Missing env fallback: repo `.env` / `.env.local` and existing `NEXT_PUBLIC_` / `EXPO_PUBLIC_` Supabase/admin phone aliases.
  - `board-categories-list`로 `insurance-news`를 찾고, 없으면 `board-category-create`로 생성한다.
  - `board-list`에서 같은 제목의 당일 digest를 찾으면 skip한다.
  - `board-create`로 게시한다.
- Codex automation
  - 매일 08:30 KST 실행
  - 최근 24시간 보험 관련 웹자료를 검색하고, 신뢰 출처 중심으로 3~5개 이슈를 한국어 digest로 요약한다.
  - digest JSON을 `.codex-tmp/insurance-digest/YYYY-MM-DD.json`에 저장하고 `--input-file`로 게시 스크립트를 실행한다.

## Key Constraints
- `board_posts` 직접 insert 금지.
- 원문 전문 복제 금지. 짧은 요약과 짧은 출처명만 게시한다.
- 원문 URL은 `sourceUrls` payload에 보관해 검증하고, 게시글 본문에는 긴 raw URL을 노출하지 않는다.
- 문장은 아주 짧고 쉬운 한국어로 작성한다.
- 유효한 `http/https` 출처 URL이 없으면 게시하지 않는다.
- Codex automation runner가 shell 실행 자체에 실패하면 게시 완료로 보고하지 않는다.
- 게시글 하단에 AI 참고용/비자문 disclaimer를 붙이지 않는다.
- schema/migration 변경 없음.

## Verification Targets
- `node --test scripts/ops/post-insurance-digest.test.mjs`
- `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/YYYY-MM-DD.json --dry-run`
- `node scripts/ci/check-governance.mjs`
