doc_id: FC-APP-EXAM-FLOWS
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-04-14
source_of_truth: app/exam-apply*.tsx + app/exam-register*.tsx + app/exam-manage*.tsx

# Mobile Playbook: Exam Flows

## 목적

- FC의 생명/손해 시험 신청과 관리자 측 시험 일정/신청자 관리를 분리 설명

## 진입 경로

- FC: `exam-apply`, `exam-apply2`
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

- FC 신청/취소
- 관리자 일정 생성/수정/삭제
- 신청자 삭제
- 응시료 납입 계좌 복사(클립보드)

## 상태/분기

- 생명/손해 흐름이 분리됨
- 마감일 필터 기준은 최근 정책을 따라야 함
- `manager`는 항상 쓰기 금지
- `exam-manage`, `exam-manage2`는 홈 대시보드와 같은 톤의 소속 quick filter를 제공
- `exam-manage`, `exam-manage2`는 `exam_registrations.resident_id`와 `fc_profiles.phone`를 raw/digits/hyphenated 후보로 매칭해야 한다. exact phone match 하나만 두면 신청자 카드가 통째로 사라질 수 있다.
- `exam-manage`, `exam-manage2`가 `exam_registrations -> exam_locations`를 embed할 때는 `exam_locations!exam_registrations_location_round_fkey`처럼 관계를 명시해야 한다. 현재 스키마는 `location_id` FK와 `(location_id, round_id)` FK가 둘 다 있어 bare `exam_locations (...)` select는 `PGRST201`로 실패하고 화면이 빈 목록처럼 보일 수 있다.
- 주민번호 trusted read(`admin-action:getResidentNumbers`)는 보조 정보다. `appSessionToken`이 없거나 full-view 조회가 실패해도 신청자 목록 자체는 계속 보여야 하며, 주민번호 필드만 degrade되어야 한다.
- 신청자 목록 query가 실패하면 화면은 `검색 결과가 없습니다`로 숨기지 말고 실제 오류를 보여줘야 한다.
- `exam-apply`, `exam-apply2`는 `응시료 납입 계좌` 복사 버튼을 제공
- Android new architecture/Fabric에서는 `exam-apply*`, `exam-register*`의 main scroll ownership을 plain `ScrollView` 하나로 유지한다. `KeyboardAwareWrapper + RefreshControl + 큰 조건부 렌더` 조합은 `/referral` crash family와 같은 mount instability를 만들 수 있으므로 Android에서는 쓰지 않는다.

## 연관 문서

- [../admin-web/exam-and-referral-ops.md](E:/hanhwa/fc-onboarding-app/docs/handbook/admin-web/exam-and-referral-ops.md)
