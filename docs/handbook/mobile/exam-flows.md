doc_id: FC-APP-EXAM-FLOWS
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-07-25
source_of_truth: app/exam-apply*.tsx + app/exam-register*.tsx + app/exam-manage*.tsx

# Mobile Playbook: Exam Flows

## 목적

- FC의 생명/손해 시험 신청과 관리자 측 시험 일정/신청자 관리를 분리 설명

## 진입 경로

- FC 및 본부장·총무·개발자 대리 신청: `exam-apply`, `exam-apply2`
- Admin/Manager: `exam-register`, `exam-register2`, `exam-manage`, `exam-manage2`

## 표시 역할

- FC
- `admin`
- `manager` read-only

## 읽는 데이터

- 시험 라운드, 마감일, 신청 상태
- 신청자 목록
- 응시료/안내 문구
- 응시료 납입 계좌 복사 대상 텍스트
- 관리자/본부장용 소속 quick filter 후보

## 쓰는 데이터

- FC 본인 신청/취소
- 본부장·총무·개발자의 선택 FC 대리 신청/미확정 신청 수정
- 관리자 일정 생성/수정/삭제
- 신청자 삭제
- 응시료 납입 계좌 복사(클립보드)

## 상태/분기

- 생명/손해 흐름이 분리됨
- 마감일 필터 기준은 최근 정책을 따라야 함
- `manager`는 일정·신청자 관리 쓰기가 금지되지만, FC를 명시적으로 선택한 대리 신청은 허용
- `exam-manage`, `exam-manage2`는 홈 대시보드와 같은 톤의 소속 quick filter를 제공
- `exam-manage`, `exam-manage2`는 `exam_registrations.resident_id`와 `fc_profiles.phone`를 raw/digits/hyphenated 후보로 매칭해야 한다. exact phone match 하나만 두면 신청자 카드가 통째로 사라질 수 있다.
- `exam-manage`, `exam-manage2`가 `exam_registrations -> exam_locations`를 embed할 때는 `exam_locations!exam_registrations_location_round_fkey`처럼 관계를 명시해야 한다. 현재 스키마는 `location_id` FK와 `(location_id, round_id)` FK가 둘 다 있어 bare `exam_locations (...)` select는 `PGRST201`로 실패하고 화면이 빈 목록처럼 보일 수 있다.
- 주민번호 trusted read(`admin-action:getResidentNumbers`)는 보조 정보다. `appSessionToken`이 없거나 full-view 조회가 실패해도 신청자 목록 자체는 계속 보여야 하며, 주민번호 필드만 degrade되어야 한다.
- 신청자 목록 query가 실패하면 화면은 `검색 결과가 없습니다`로 숨기지 말고 실제 오류를 보여줘야 한다.
- `exam-apply`, `exam-apply2`는 `응시료 납입 계좌` 복사 버튼을 제공
- 입금일은 사용자가 입력하지 않는다. 신규 v3 신청은 필수 증빙 이미지만 받고 `fee_paid_date`를 `null`로 저장하며, 과거 신청의 날짜 값은 조회·표시용으로 보존한다.
- Android new architecture/Fabric에서는 `exam-apply*`, `exam-register*`의 main scroll ownership을 plain `ScrollView` 하나로 유지한다. `KeyboardAwareWrapper + RefreshControl + 큰 조건부 렌더` 조합은 `/referral` crash family와 같은 mount instability를 만들 수 있으므로 Android에서는 쓰지 않는다.

## 2026-06-03 관리자 시험 등록 메모

- `exam-register`, `exam-register2`의 `시험 추가` 버튼은 create mode로 하단 입력 폼을 열고 자동 스크롤해야 한다.
- 각 시험 row의 `수정` 버튼은 해당 row를 edit mode로 선택한 뒤 같은 하단 폼 위치로 이동해야 한다.
- 생명/손해 시험 등록 화면은 add/edit scroll helper와 폼 ownership을 같은 패턴으로 유지해 한쪽 화면만 동작하는 drift를 만들지 않는다.

## 2026-06-05 FC 시험 신청 메모

- `exam-apply`, `exam-apply2`의 신청 CTA는 필수값이 비었을 때 단순 비활성 처리로 끝내지 않고 `getMissingExamApplicationFields` 결과를 alert로 보여준다.
- 화면 문구는 `응시료 납입 안내`로 통일하며, 응시료 안내 표시는 `lib/exam-fees.ts`의 단일 계약을 따른다.
- 생명보험/손해보험/제3보험 단독 및 생명+제3, 손해+제3 조합의 응시료는 모두 2만원으로 안내한다.

## 연관 문서

- [../admin-web/exam-and-referral-ops.md](../admin-web/exam-and-referral-ops.md)

## 2026-07-03 Shared Function Contract

- `exam-manage.tsx` and `exam-manage2.tsx` must use `lib/exam-display.ts` for resident-number display, exam date display, exam round/location summary text, and phone candidate normalization.
- Do not reintroduce screen-local `formatResidentNumber`, `normalizeSingle`, `buildPhoneCandidates`, `formatYmd`, or `buildExamInfo` helpers in those screens.
- Regression evidence: `lib/__tests__/exam-display.test.ts` and `lib/__tests__/shared-function-contracts.test.ts`.

## 2026-07-04 Shared Exam Flow Contract

- `exam-apply.tsx`, `exam-apply2.tsx`, `exam-register.tsx`, and `exam-register2.tsx` must use `lib/exam-flow-contract.ts` for life/nonlife route keys, query keys, notification channels, payment-account copy, selection keys, and form-state defaults.
- Life/nonlife differences should be expressed as config in the shared contract, not as screen-local branching that can drift.
- Regression evidence: `lib/__tests__/exam-flow-contract.test.ts`.

## 2026-07-22 Admin exam registration interaction contract

- `exam-register` and `exam-register2` keep one plain `ScrollView` as the Android scroll owner. A surrounding `KeyboardAvoidingView` resizes the available viewport, and the focused input is scrolled into view again after the keyboard becomes visible.
- The location-add action is disabled while the trimmed location name is empty. Once valid text is present, it uses the solid orange accent state so enabled and disabled states are visually distinct.
- Registered exam rounds are displayed by exam date descending. Registration deadline and creation time provide deterministic descending tie breakers.
- Life and nonlife registration screens use the shared `sortExamRoundsNewestFirst` policy and must not implement independent ordering rules.

## 2026-07-22 FC exam application availability and Realtime contract

- When no round remains open for application, both application screens show `현재 신청 가능한 시험이 없습니다.` in the schedule selector while retaining recent closed rounds as read-only context.
- Each application-screen effect creates an opaque, unique Realtime channel topic. Do not put a resident identifier in a topic, and do not reuse a topic while an earlier channel may still be leaving.
- Register every `postgres_changes` callback before calling `subscribe()`, and remove the exact channel in the effect cleanup.

## 2026-07-13 저장·알림 원자성 계약

- FC 시험 신청은 등록 row를 먼저 확정한 뒤 관리자/본인 알림을 `sendExamApplyNotificationsBestEffort`로 병렬 전송한다. 일부 알림 실패는 `failedTargets` 경고로 남기되 이미 저장된 신청을 mutation 실패로 되돌리지 않으며, 사용자가 같은 신청을 중복 재시도하도록 만들지 않는다.
- 모바일 시험 알림은 `invokeFcNotify`의 app-session 헤더 계약을 사용하고, 관리자 승인 알림은 인증 쿠키가 포함된 `/api/fc-notify` 서버 경계를 사용한다.
- 관리자 회차 저장은 검증된 admin session과 중앙 payload parser를 거친 뒤 `save_exam_round_atomic` RPC로 회차와 장소를 한 트랜잭션에서 갱신한다. 조회는 read-only admin session을 허용하고, 삭제는 parent round 한 건을 삭제해 FK cascade 계약을 따른다.

## 2026-07-25 응시료 입금 증빙·대리 신청 계약

- `submit_exam_registration_with_payment_proof`는 반환 열 `registration_id`와 upload table 열 이름이 충돌하지 않도록 모든 upload 열 참조를 table-qualified로 유지합니다.
- Edge Function이 4xx/5xx 구조화 응답을 반환하면 앱은 `FunctionsHttpError.context`의 안전한 `message`를 표시합니다. 서버가 실제 안내를 보냈는데 일반 연결 실패로 바꾸면 안 됩니다.

- `exam-apply`, `exam-apply2`는 입금일 입력 없이 이미지 1개를 필수로 받는다. JPG, PNG, WebP만 허용하고 최대 크기는 10MB다.
- 필수값 누락은 CTA를 침묵시키지 않고 `입금 내역 캡처`를 기존 누락 항목 alert에 포함한다.
- 사진은 private `exam-payment-proofs` bucket에 저장하며 공개 URL을 만들지 않는다. 서명된 앱 세션을 검증한 `exam-payment-proof` Edge Function만 업로드 URL을 발급하고 신청 저장/취소를 수행한다.
- 신규 앱은 `submit_exam_registration_with_payment_proof_v3`를 사용한다. 대상 FC, 월 슬롯, 증빙 귀속, 신청 row, 행위자 감사 이벤트를 한 트랜잭션 계약으로 묶고, 기존 v1/v2 날짜 계약은 구버전 호환용으로 유지한다.
- 기존 증빙이 있는 미확정 신청은 사진을 새로 고르지 않아도 수정할 수 있다. 새 사진을 고르면 성공한 저장 뒤 이전 object를 best effort로 정리한다.
- 본부장·총무·개발자는 활성 FC 목록에서 이름·소속·전화번호 끝 4자리로 대상을 선택한다. body의 역할은 신뢰하지 않고 signed app session과 활성 계정 row로 행위자를 다시 확인한다.
- FC는 다른 대상 ID를 보낼 수 없다. 직원 대리 신청은 선택 FC 기준으로 월 1회 제한과 이력을 적용하며, 대리 취소는 이 화면에서 제공하지 않는다.
- 감사 이벤트에는 `actor_type`, 관리자/본부장 actor snapshot, `target_fc_id_snapshot`을 남긴다.
- 호환 배포 순서는 additive migration + 새 Edge Function → 구버전 호환 확인 → 모바일 OTA/앱 → 관리자 증빙 검토 surface다. 기존 알림 복구 릴리스와 섞어 배포하지 않는다.
