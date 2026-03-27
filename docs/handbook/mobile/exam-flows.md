doc_id: FC-APP-EXAM-FLOWS
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-03-26
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

## 쓰는 데이터

- FC 신청/취소
- 관리자 일정 생성/수정/삭제
- 신청자 삭제

## 상태/분기

- 생명/손해 흐름이 분리됨
- 마감일 필터 기준은 최근 정책을 따라야 함
- `manager`는 항상 쓰기 금지

## 연관 문서

- [../admin-web/exam-and-referral-ops.md](E:/hanhwa/fc-onboarding-app/docs/handbook/admin-web/exam-and-referral-ops.md)
