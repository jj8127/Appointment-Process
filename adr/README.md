# Architecture Decision Records

이 디렉토리는 `fc-onboarding-app`의 중장기 아키텍처 결정을 기록합니다.

- 기준일: `2026-03-08`
- 운영 기준 문서: `../AGENTS.md`

## ADR 목록

| 번호 | 제목 | 상태 |
|------|------|------|
| [0001](0001-record-architecture-decisions.md) | ADR 도입 | Accepted |
| [0002](0002-custom-authentication-system.md) | 커스텀 인증 시스템 | Accepted |
| [0003](0003-theme-system-and-reusable-components.md) | 테마 시스템 및 재사용 컴포넌트 | Accepted |
| [0004](0004-referral-schema-baseline.md) | 추천인 스키마 베이스라인 | Proposed |

## ADR을 남겨야 하는 경우

다음 항목은 가능하면 ADR로 남깁니다.

1. 인증/세션 모델 변경
2. Supabase 스키마 또는 RLS 정책의 큰 구조 변경
3. request_board 연동 방식 변경
4. 모바일/웹 공통 아키텍처 패턴 변경
5. 배포/운영 모델 변경

예시:

- request_board 브릿지 로그인/세션 자동 복구 구조
- 관리자 웹 푸시 채널 구조
- 민감정보 저장/조회 정책 변경

## 파일명 규칙

```text
XXXX-kebab-case-title.md
```

예:

- `0004-request-board-session-bridge.md`
- `0005-admin-web-push-delivery.md`

## 권장 템플릿

```markdown
# ADR [번호]: [제목]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Context
[결정이 필요한 배경]

## Decision
[채택한 결정]

## Consequences
### Pros
- [장점]

### Cons
- [단점]

## Alternatives Considered
1. [대안] - [선택하지 않은 이유]
```

## 상태 의미

| 상태 | 의미 |
|------|------|
| Proposed | 검토 중 |
| Accepted | 채택되어 운영 중 |
| Deprecated | 더 이상 권장하지 않음 |
| Superseded | 다른 ADR로 대체됨 |
