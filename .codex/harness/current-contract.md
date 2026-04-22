# Current contract

## Increment
- Name: Legacy recommender outreach follow-up
- Goal: keep the remaining missing-recommender operator list current after the exact-unique batch, and send internal messenger reminders from the requested developer account to the 34 blocked rows.

## Exact scope
- Reporting/ops scripts
  - `scripts/reporting/export-missing-recommender-report.mjs`
  - `scripts/reporting/export-missing-recommender-outreach-report.mjs`
  - `scripts/reporting/reconcile-legacy-recommenders.mjs`
  - `scripts/reporting/send-missing-recommender-messages.mjs`
  - `package.json`
- Referral test and handoff artifacts
  - `docs/referral-system/TEST_RUN_RESULT.json`
  - `.claude/WORK_LOG.md`
  - `.claude/WORK_DETAIL.md`
  - `.codex/harness/product-spec.md`
  - `.codex/harness/plan.md`
  - `.codex/harness/qa-report.md`
  - `.codex/harness/handoff.md`
  - `.codex/harness/reports/fc-missing-recommender-2026-04-22-after-link.*`
  - `.codex/harness/reports/fc-missing-recommender-2026-04-22-outreach.*`
  - `.codex/harness/reports/legacy-recommender-reconcile-2026-04-22.*`
  - `.codex/harness/reports/missing-recommender-message-send-2026-04-22.*`

## Acceptance criteria
- [x] 레거시 추천인 문자열이 있는 unresolved FC를 정책 SSOT 기준(`자동 연결 가능 / 후보 없음 / 자기추천`)으로 분류한다.
- [x] exact-unique이며 정책상 허용되는 후보만 구조화 추천인으로 연결한다.
- [x] exact-unique지만 active code가 없던 inviter는 code를 먼저 보장한 뒤 link를 적용한다.
- [x] `self_referral` 또는 `missing_candidate` 항목은 자동 적용하지 않는다.
- [x] apply 결과가 `fc_profiles.recommender_fc_id`와 `admin_override_applied` 이벤트에 남는다.
- [x] 적용 후 미등록 FC 보고서가 감소한 건수로 다시 생성된다.
- [x] 남은 34건에는 `01058006018` 개발자 계정 actor id로 내부 메신저 안내 메시지가 저장된다.
- [x] 최신 운영 목록은 발송 대상 여부와 발송 상태까지 포함한 엑셀용 CSV로 다시 생성된다.

## Checks run
- `npm run report:legacy-recommenders -- --date=2026-04-22`
- `npm run report:legacy-recommenders -- --date=2026-04-22 --apply`
- `npm run report:missing-recommender -- --date=2026-04-22-after-link`
- `npm run ops:send-missing-recommender-messages -- --date=2026-04-22`
- `npm run ops:send-missing-recommender-messages -- --date=2026-04-22 --apply`
- `npm run report:missing-recommender-outreach -- --date=2026-04-22`

## Rollback / containment
- 이 increment는 exact-unique만 자동 적용한다. `missing_candidate`와 `self_referral`을 억지로 연결하는 추가 heuristic은 넣지 않는다.
- 향후 남은 34건을 정리할 때도 먼저 active candidate exact match를 보지 않고 fuzzy alias를 적용하면 안 된다.
- 보고서 원본 CSV가 스프레드시트에서 열려 있으면 같은 파일명 overwrite가 `EBUSY`로 실패할 수 있으니, 후속 보고서는 새 suffix로 생성한다.
- 메시지 발송 스크립트는 같은 날 같은 발신자·같은 수신자·같은 문구가 이미 있으면 다시 넣지 않는다.
