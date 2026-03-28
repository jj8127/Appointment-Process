doc_id: FC-APP-ONBOARDING
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-03-28
source_of_truth: app/index.tsx + app/home-lite.tsx + app/fc/new.tsx + app/consent.tsx + app/docs-upload.tsx + app/hanwha-commission.tsx + app/appointment.tsx + lib/fc-workflow.ts

# Mobile Playbook: FC Onboarding

## 목적

- FC가 가입 후 본등록, 수당동의, 서류, 위촉까지 스스로 진행하도록 안내

## 진입 경로

- `index`
- `home-lite`
- `fc/new`
- `consent`
- `docs-upload`
- `hanwha-commission`
- `appointment`

## 표시 역할

- `fc`

## 읽는 데이터

- `fc_profiles`
- 현재 `status`
- 요청 서류 목록/제출 상태
- 한화 위촉 제출/승인/PDF 상태
- appointment 제출/완료 상태
- 커미션 완료 플래그

## 쓰는 데이터

- FC 기본정보 저장
- 수당 동의 저장
- 서류 업로드/재제출
- 한화 위촉 완료일 제출
- 위촉 제출

## 상태/분기

- `home-lite`는 unlock 전 안내 역할
- temp-id 선행 없이 consent를 완료할 수 없음
- docs request가 있어야 `docs-upload`가 활성 역할을 가짐
- 서류 승인 뒤에는 바로 appointment가 아니라 `hanwha-commission` 단계가 열림
- 한화 승인과 PDF 등록이 끝나야 `appointment` 단계가 열린다

## 사용자 액션

- 프로필 저장
- 동의 제출
- 파일 업로드/교체
- 한화 위촉 완료일 제출
- 한화 PDF 열람
- 위촉 제출

## 성공 결과

- 상태가 다음 단계로 이동
- 관리자 검토 대기 또는 완료

## 실패/예외

- 기술 에러는 사용자용 한국어 알림으로 변환
- schema drift가 있으면 관리자 쪽 저장/조회와 어긋날 수 있음

## 연관 문서

- [../workflow-state-matrix.md](E:/hanhwa/fc-onboarding-app/docs/handbook/workflow-state-matrix.md)
- [../admin-web/dashboard-lifecycle.md](E:/hanhwa/fc-onboarding-app/docs/handbook/admin-web/dashboard-lifecycle.md)
