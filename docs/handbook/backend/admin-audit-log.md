# 관리자 처리·다운로드·개인정보 조회 기록

## 저장소

- 테이블: `public.admin_audit_events` (`supabase/migrations/20261016100000_admin_audit_events.sql`).
- append-only다. update·delete·truncate는 trigger가 거부한다. RLS를 켜고 `service_role`에만 select·insert를 준다.
- 남기는 것: 처리자(역할, 직원 구분, 직원 전화번호 숫자), 시각, 구분(`fc_action`·`export`·`personal_info_view`), 동작, 대상 FC, 대상 수, 사유, 상세(동작 코드·상태 코드·수정한 항목 이름).
- 남기지 않는 것: 주민번호 원문·복호화 값, 입력한 값 자체. 상세와 사유에 주민번호 형태가 있으면 DB check와 서버 함수가 모두 거부한다.
- 보관: 최소 2년. 자동 삭제 작업은 아직 없다.

## 기록 지점 (관리자 web 서버)

| 구분 | 지점 | 실패 시 |
|---|---|---|
| 처리 | `api/admin/fc` 변경 동작(성공 응답 후), 서류·위촉 server action, 공지 등록·수정 | 처리는 유지하고 서버 로그만 남김 |
| 엑셀 다운로드 | `POST /api/admin/audit/export` (파일 생성 전, 사유 선택 필수) | 다운로드 중단(503) |
| 개인정보 조회 | `POST /api/admin/resident-numbers`, 주민번호가 포함된 `GET /api/admin/exam-applicants` | 주민번호·목록을 반환하지 않음(503) |

- 시험 접수 결정은 기존 `exam_registration_decision_events`가 기록하며, 처리 이력 화면이 함께 보여준다.
- Edge Function `admin-action`을 직접 호출하는 경로(모바일 관리자 화면)는 이 기록에 포함되지 않는다.

## 화면

- `/dashboard/audit` (관리자 쓰기 권한 계정만). 월 단위 조회로 월 1회 점검에 쓴다. 구분 필터, 처리자·대상 이름 검색, 최근 500건.
- API: `GET /api/admin/audit?month=YYYY-MM&category=` (관리자 전용).

## 운영 적용 순서

1. migration 적용 후 테이블·trigger·권한을 확인한다.
2. 그다음 관리자 web을 배포한다. 반대 순서면 주민번호 조회와 시험 신청자 목록이 503으로 막힌다.
