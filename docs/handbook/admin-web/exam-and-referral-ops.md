doc_id: FC-ADMIN-EXAM-REFERRAL
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-08-04
source_of_truth: web/src/app/dashboard/exam/* + web/src/app/admin/exams/* + web/src/app/api/admin/exam-applicants/* + web/src/app/dashboard/referrals/page.tsx + web/src/app/dashboard/referrals/graph/page.tsx + web/src/app/api/admin/referrals/route.ts

# Admin Web Playbook: Exam And Referral Ops

## 2026-07-06 Exam Applicants API Auth Contract

- `/api/admin/exam-applicants` is a privileged admin web API and must use the signed server-session helper before reading or mutating applicant data.
- Caller-supplied role or resident identity values are ignored for authorization; admin/manager capabilities come only from the verified session.

## 포함 화면

- `/dashboard/exam/schedule`
- `/dashboard/exam/applicants`
- `/admin/exams/*`
- `/dashboard/referrals`
- `/dashboard/referrals/graph`

## 시험 운영

- 라운드 생성/수정/삭제
- 라운드 생성/수정은 canonical `save_exam_round_atomic_v2` service-role RPC가 운영 DB에 먼저 적용된 뒤에만 활성화한다. 구 `save_exam_round_atomic`은 정확일 caller 호환 wrapper로만 유지한다. PostgREST `PGRST202`는 입력 오류가 아니라 RPC rollout 누락으로 분류하며, 다중 쿼리 fallback으로 우회하지 않는다.
- 신청자 조회/삭제
- legacy admin 시험 화면과 최신 dashboard 시험 화면이 공존
- `/dashboard/exam/applicants` 는 상단 소속 quick filter를 제공
- 소속 quick filter는 현재 신청자 데이터와 별개로 `2본부 박성훈`, `6본부 김정수`, `9본부 김주용`, `10본부 한태균`을 항상 노출한다. 기존 복합 소속값은 짧은 운영 표기로 정규화해 같은 필터로 매칭하고, 본부 번호는 숫자로 정렬한다.
- `/dashboard/exam/applicants` 는 소속 quick filter 아래에 `시험 종류`와 `시험 회차` 상단 필터를 제공한다. 적용 순서는 `소속 quick filter -> 시험 종류 -> 시험 회차 -> 테이블 헤더 필터`다.
- 시험 종류/회차 필터 옵션은 `/api/admin/exam-applicants` 응답의 `round_id`, `round_label`, `exam_date`, `exam_type`, `is_third_exam`를 client helper에서 중복 제거해 만든다. 회차 메뉴는 날짜·회차·과목을 분리해 표시하고 선택 상태를 체크 아이콘과 주황 배경으로 구분한다.
- 총 신청자/접수 완료/미접수 통계 카드는 버튼이며 접수 상태 필터를 적용한다. 통계 숫자는 소속·시험·헤더 필터까지 적용하되 접수 상태 자체는 제외한 모집단에서 계산해, 접수 카드 선택 후에도 완료/미접수 비교 수치가 흔들리지 않는다. XLSX 다운로드는 최종 `filteredRows`를 따른다.
- 신청자 row는 접수 완료를 옅은 주황, 미접수를 옅은 회색으로 구분하고 상태 변경 직후 같은 색 계약을 따른다. hover 라벨은 마우스를 따라가되 커서보다 위쪽에 반투명 배경으로 표시하며 소속과 이름만 노출한다.
- 신청자 row 클릭 또는 키보드 Enter/Space는 `/dashboard/exam/applicants/[id]` 상세로 이동한다. 상세는 신청자·시험·접수 상태를 한 화면에 표시하고 admin에게 `시험 접수하기`를 제공한다. manager는 상세를 읽을 수 있지만 접수/삭제 등 쓰기 액션은 계속 비활성이다.
- `/dashboard/exam/applicants`의 공용 신청자 컬럼 뒤에는 `입금 증빙` 컬럼 하나만 추가한다. 첨부 row의 `보기`는 활성 admin/manager 세션을 확인하는 image route를 새 탭으로 열고, 미첨부 row는 `없음`으로 표시한다.
- `/dashboard/exam/applicants/[id]`의 `시험 신청 정보` 카드 바로 아래에는 `입금 증빙 확인` 카드를 둔다. 첨부 사진과 원본 열기를 제공하되 승인/거절, OCR, 입금일 비교 상태나 별도 검토 workflow는 만들지 않는다.
- XLSX 다운로드는 최종 `filteredRows`를 유지하면서 `접수 상태`, `입금 증빙 경로`, `입금 증빙 URL (30일 유효)`를 덧붙인다. 제목·헤더·본문은 흰색과 연회색 중심의 미니멀한 실무 양식을 따르되, `접수 완료` 행은 아주 옅은 주황색을 전체 열에, `반려` 행은 아주 옅은 빨간색을 전체 열에 적용한다. 그 외 행은 흰색을 유지하고 상태 셀과 증빙 링크만 제한적으로 강조한다. 다운로드를 시작한 활성 admin/manager만 private Storage path와 30일 signed URL을 발급받을 수 있고, 발급된 URL 자체는 admin web 세션 없이 열 수 있다. 파일은 제목·요약·고정 헤더·자동 필터·얇은 테두리·열 너비·증빙 하이퍼링크를 포함하고, 전화번호와 주민번호는 앞자리 0이 보존되는 텍스트 셀로 저장한다.
- 신청자 상세의 `이전 신청자`/`다음 신청자`는 목록과 같은 `created_at DESC, id DESC` 순서를 사용한다. 첫 신청자의 이전 버튼과 마지막 신청자의 다음 버튼은 비활성화하며, 이동 중 개인 식별값을 URL label이나 로그에 추가하지 않는다.
- 상세 API의 `registrationId` 조회는 선택 row 하나를 찾은 뒤 동일 신청자의 과거 이력을 함께 읽어 `신규신청/재신청`을 계산하고, enrichment 직전에 선택 row로 다시 좁힌다. 선택 row만 먼저 분류해 재신청 이력을 잃지 않는다.
- 공용 신청자 목록 컬럼 순서와 badge wrapping은 `web/src/lib/exam-applicant-list-display.ts`의 shared contract를 따른다. canonical dashboard만 공용 컬럼 뒤에 증빙 표시/XLSX 필드를 추가한다. `시험 신청일`은 `exam_registrations.created_at`에서 날짜만 표시하며 테이블과 XLSX에 함께 포함한다. `/admin/exams/[id]`는 특정 `roundId`를 서버 API로 조회하므로 별도의 상단 회차 필터를 추가하지 않는다.
- 공용 신청자 목록은 `신청 상태`와 `접수 상태`를 분리한다. `신청 상태`는 `exam_registrations.status`를 기준으로 `신청 완료`, `시험 완료`, `미응시`, `반려`, `본인 취소`, `관리자 취소`를 표시하며 알 수 없는 값은 `-`로 닫는다. `접수 상태`는 `is_confirmed`만 기준으로 `접수 완료`/`미접수`를 표시한다. canonical XLSX도 최종 필터 결과에 같은 `신청 상태` 열을 포함한다.
- resident number/full view는 운영 역할(admin/manager/developer) 기준으로 읽을 수 있고, `manager`는 모든 쓰기 액션이 비활성
- GaramIn 모바일의 시험 탭에서는 본부장·총무·개발자가 FC를 선택해 신청을 대신 제출할 수 있다. 이 예외는 관리자 웹의 일정/접수 상태 변경 권한을 확장하지 않는다.
- 대리 신청은 `submit_exam_registration_with_payment_proof_v3`와 append-only decision event를 사용하며, 신규 row의 수기 `fee_paid_date`는 `null`이다. 과거 날짜는 변경하거나 삭제하지 않는다.
- 대리 신청 대상 목록에는 가입을 완료한 순수 FC만 노출한다. 활성 본부장 계정, 설계매니저 연동 프로필, 활성 총무·관리자·개발자 계정과 겹치는 프로필은 목록과 서버 대상 검증에서 모두 제외한다. 이 제한은 기존 앱의 FC 본인 신청과 본부장 본인 신청 호환 경로에는 적용하지 않는다.
- `/api/admin/exam-applicants` 는 `exam_registrations.resident_id` 와 `fc_profiles.phone` 를 raw/digits/hyphenated 후보로 매칭한 뒤 `fc_identity_secure` 에서 full resident number를 읽는다.
- `/dashboard/exam/applicants` 에서 주민등록번호 열이 일괄 `주민번호 조회 실패` 로 보이면 우선 `exam_registrations.resident_id` 와 `fc_profiles.phone` 포맷 drift, 그다음 `fc_identity_secure` 누락을 확인한다.
- 2026-05-30 기준 `/api/admin/exam-applicants` enrichment는 `web/src/lib/exam-applicant-resident-number-enrichment.ts`가 row defaults, phone candidate matching, `fcIds` de-dupe, full resident-number merge, `주민번호 조회 실패` fallback literal을 고정한다.

## 추천인 운영

- backfill
- rotate code
- disable code
- manager는 read-only
- `/dashboard/referrals/graph`는 구조화 추천 관계를 읽기 전용으로 탐색한다.
- 그래프 edge는 `fc_profiles.recommender_fc_id` 기반 current-state를 기준으로 그리고, graph 안에서 mutation CTA를 열지 않는다.
- 그래프 노드는 `life_commission_completed`/`appointment_date_life`와 `nonlife_commission_completed`/`appointment_date_nonlife`가 모두 완료 evidence일 때 초록색으로 표시한다. 초록은 추천코드 상태를 바꾸지 않는 별도 위촉 완료 강조색이다.
- 그래프 범례는 색상 기준으로 읽는다: 초록=생명·손해 위촉 모두 완료, 주황=추천코드 사용 중, 노랑 표시=본부장 강조 또는 예전 기록 확인 테두리, 회색=추천코드 없음/중지.
- Obsidian Graph View를 참고하되 추천인 tree 가독성에 맞춘 hybrid layout 계약을 유지한다. runtime은 d3 `charge`와 기존 `link`에 link tension, branch bend, sibling angular separation, node/cluster separation, weak cluster gravity, drag rope constraint를 보조 force로 더한다.
- 초기 seed는 component 크기순 중앙 배치, hub child star/pinwheel, 제한된 isolated golden-angle 분포를 제공한다. isolated node 기본 노출과 toggle은 UI 필터 계약이며, runtime에서 강제 outer ring force를 쓰지 않는다.
- node drag는 pointer 대상 노드 하나만 임시 `fx/fy`로 고정한다. direct·2-hop 이상 연결 노드는 별도 고정이나 같은-delta 이동 없이 평소 link·link-tension·charge·collision force로 단계적으로 반응하고, drag 시작 edge 길이의 `1.2x` 최대 stretch를 지킨다. release는 `fx/fy` hard pin 해제와 simulation reheat를 수행해 spring momentum을 이어가며 decaying drop tether를 주입하지 않는다.
- 물리 slider는 `Center force`, `Repel force`, `Link force`, `Link distance` 네 항목이며 범위와 기본값은 Obsidian 의미를 따른다.
- 기본 이름 label은 숨기지 않고, 추천코드 detail은 선택/검색 상태에서만 확장한다.

## 2026-08-04 시험일 미정 회차 운영

- `/dashboard/exam/schedule`에서 `시험일 미정`을 선택하면 `시험 월`을 반드시 선택한다. 정확일을 사용하면 월은 해당 날짜의 월초로 자동 파생한다.
- 서버 input policy는 실존하는 월초 날짜만 받고, 정확일과 월이 충돌하면 저장을 거부한다. 정확일만 보내는 legacy caller는 월을 자동 파생하지만, 신규 TBD payload는 명시적 월 없이 저장할 수 없다.
- 회차·장소 저장은 `save_exam_round_atomic_v2` service-role RPC를 사용한다. DB migration이 운영에 먼저 적용되지 않은 상태에서 이 writer를 배포하지 않으며, `PGRST202`를 다중 query fallback으로 우회하지 않는다.
- 기존 TBD 회차를 수정할 때는 저장된 `exam_month`를 form에 hydrate한다. 정확일을 추후 확정하는 경우 신청 이력이 있으면 기존 월 안의 날짜만 허용된다.
- 모바일 관리자도 같은 writer 계약을 사용한다. 새 요청은 canonical `exam_month`를 명시하고 `admin-action`은 `save_exam_round_atomic_v2`만 호출한다.
- 구 모바일의 exact-date 요청은 검증된 날짜에서 월을 파생해 호환할 수 있지만, 기존 `exam_date = null` 회차를 명시적 month 없이 수정하는 요청은 오늘 날짜 implicit 확정을 막기 위해 RPC 전에 거절한다.
- caller 활성화 전 `20260804081357_exam_round_month_for_tbd.sql`, exact v2 signature, service-role-only ACL, TBD/exact/invalid/rollback 대표 transaction을 배포 runbook에서 확인한다. 구 migration과 legacy writer 확인만으로는 활성화할 수 없다.

## 연관 문서

- [../data/referral-schema-and-admin-rpcs.md](../data/referral-schema-and-admin-rpcs.md)
- [../backend/admin-operations-api.md](../backend/admin-operations-api.md)
