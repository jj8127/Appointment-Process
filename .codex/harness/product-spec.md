# Product spec

## Task summary
- 추천인 미등록 FC 중 free-text `recommender` 값이 남아 있는 대상들을 운영 정책 기준으로 재분류한다.
- exact-unique로 안전하게 연결 가능한 케이스만 구조화 추천인(`recommender_fc_id`)으로 승격한다.
- 남은 차단 대상 34명에게는 `01058006018` 개발자 계정으로 내부 메신저 안내를 보내고, 발송 상태가 붙은 운영용 CSV를 다시 생성한다.

## User outcomes
- 운영자는 “누가 아직 추천인 미등록인지”를 전화번호/이름/소속 기준으로 계속 볼 수 있다.
- 레거시 추천인 문자열이 남아 있던 FC 중 안전한 exact-unique 후보는 구조화 링크로 정리된다.
- 남은 미정리 건은 왜 막혔는지(`missing_candidate`, `self_referral`)가 보고서에 남는다.
- 남은 미정리 34건은 앱 내부 메신저로 바로 안내가 들어가고, 운영자는 목록 파일에서 발송 여부까지 함께 확인할 수 있다.

## Implementation shape
- `report:missing-recommender`
  - spreadsheet-safe CSV와 raw CSV를 함께 생성한다.
- `ops:send-missing-recommender-messages`
  - reconciliation report의 blocked 34건을 읽는다.
  - `01058006018` 계정의 internal messenger actor id를 계산해 중복 없는 text message를 넣는다.
  - `missing_candidate`와 `self_referral`에 다른 안내 문구를 쓴다.
- `report:legacy-recommenders`
  - unresolved legacy recommender를 분류한다.
  - exact-unique + active code 보유자는 바로 `admin_apply_recommender_override`를 적용한다.
  - exact-unique + code 미보유자는 `admin_issue_referral_code(p_rotate=false)`로 code를 보장한 뒤 override를 적용한다.
  - 결과를 markdown/json 보고서로 남긴다.
- `report:missing-recommender-outreach`
  - 현재 미등록 64건 전체 목록에 `outreach_required`, `blocked_reason`, `message_status`, `message_sent_at`를 붙여 다시 export한다.

## Key constraints
- 자동 적용 범위는 referral SSOT의 `안전 자동 정리` 정책을 따른다.
- `self_referral`, `missing_candidate`, fuzzy alias, 동명이인 추정 연결은 자동 적용하지 않는다.
- 추천인 연결은 trusted server path(RPC/service-role)만 사용한다.
- 감사 흔적 없는 direct profile update는 허용하지 않는다.
- 내부 메신저 발송은 app runtime과 같은 actor id 규칙을 따라야 한다. `developer`는 phone actor, 일반 총무는 `admin` actor를 쓴다.
- 같은 날 같은 발신자/수신자/문구 메시지가 이미 있으면 재실행 시 중복 발송하지 않는다.

## Verification targets
- `npm run report:legacy-recommenders -- --date=2026-04-22`
- `npm run report:legacy-recommenders -- --date=2026-04-22 --apply`
- `npm run report:missing-recommender -- --date=2026-04-22-after-link`
- `npm run ops:send-missing-recommender-messages -- --date=2026-04-22`
- `npm run ops:send-missing-recommender-messages -- --date=2026-04-22 --apply`
- `npm run report:missing-recommender-outreach -- --date=2026-04-22`
- Result artifacts:
  - `.codex/harness/reports/legacy-recommender-reconcile-2026-04-22.md`
  - `.codex/harness/reports/legacy-recommender-reconcile-2026-04-22.json`
  - `.codex/harness/reports/fc-missing-recommender-2026-04-22-after-link.csv`
  - `.codex/harness/reports/missing-recommender-message-send-2026-04-22.json`
  - `.codex/harness/reports/fc-missing-recommender-2026-04-22-outreach.csv`
