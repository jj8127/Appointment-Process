# ADR 0005: 퇴사 FC의 인증 및 수당 이력 분리

## Status

Accepted — 사용자 승인 범위는 공통 로그인과 수당 이력을 보존하면서 지정된 FC 계정만 삭제하는 운영 정리다.

## Context

공통회원의 인증이 FC credential에 의존할 수 있다. 게시된 수당 명세는 FC를 필수 참조하고 불변 가드로 보호되어 있어 계정 삭제를 막는다. 개인정보 계정을 계속 남기거나 명세를 삭제하는 방식은 요청과 맞지 않는다.

## Decision

- 공통계정 보존이 승인된 경우, 기존 동일 PBKDF2 credential과 잠금 상태를 그 회원의 독립 credential로 이관한 뒤 FC 연결을 해제한다. 비밀번호·동의·추천 정보를 임의로 바꾸지 않는다.
- FC 연결을 가진 기존 세션은 종료한다. 독립 공통 로그인은 기존 비밀번호로 다시 수행하며 FC 권한을 부여하지 않는다.
- 게시 명세의 live FK는 nullable/ON DELETE SET NULL로 바꾼다. 원본 UUID는 private snapshot 컬럼에 보존한다.
- 실제 FC 삭제의 중첩 FK 동작만 기존 불변 가드에서 허용한다. 나머지 내용·상태·다른 계정으로의 연결은 바꾸지 못한다.
- archive의 출처 멱등성·revision 유일성·단일 게시월도 보존한다. RLS, grants, API payload와 활성 수령인 권한은 유지한다.

## Consequences

- FC 계정 제거와 공통 로그인·운영 명세의 보존을 함께 처리할 수 있다.
- FC 기반 세션 사용자는 재로그인이 필요하다. archive UUID는 접근 권한이 아니라 감사용 식별자다.

## Alternatives Considered

1. FC placeholder 유지: 실제 계정 삭제가 아니고 역할·접근 판단을 혼동시킨다.
2. 게시 명세 삭제 또는 복제 보관: 기존 불변 이력과 저장·조회 경로를 변경한다.
3. 불변 trigger 비활성화: 관계 분리 외의 금액·명세 수정까지 허용하므로 사용하지 않는다.
