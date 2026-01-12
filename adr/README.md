# Architecture Decision Records (ADR)

이 폴더는 프로젝트의 주요 아키텍처 결정을 기록합니다.

## ADR 목록

| 번호 | 제목 | 상태 |
|------|------|------|
| [0001](0001-record-architecture-decisions.md) | ADR 도입 | Accepted |
| [0002](0002-custom-authentication-system.md) | 커스텀 인증 시스템 | Accepted |
| [0003](0003-theme-system-and-reusable-components.md) | 테마 시스템 및 재사용 컴포넌트 | Accepted |

## ADR 작성 가이드

### 언제 ADR을 작성하나요?
1. DB 스키마 변경
2. 새로운 라이브러리/프레임워크 도입
3. 기존 패턴 변경
4. 폴더 구조 재구성
5. API 계약 변경

### 파일명 규칙
```
XXXX-kebab-case-title.md
```
예: `0004-add-push-notification-system.md`

### 템플릿
```markdown
# ADR [번호]: [제목]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Context
[결정이 필요한 배경/상황]

## Decision
[결정 내용]

## Consequences
### Pros
- [장점]

### Cons
- [단점]

## Alternatives Considered
1. [대안]: [왜 선택하지 않았는지]
```

## 상태 설명

| 상태 | 의미 |
|------|------|
| Proposed | 제안됨, 아직 결정 안됨 |
| Accepted | 승인됨, 현재 적용 중 |
| Deprecated | 더 이상 권장하지 않음 |
| Superseded | 다른 ADR로 대체됨 |
