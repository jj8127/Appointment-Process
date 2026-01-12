# ADR 0001: Architecture Decision Records 도입

## Status
Accepted

## Context
- 프로젝트가 성장하면서 아키텍처 결정의 이유가 불분명해지는 경우가 발생
- 새로운 개발자(또는 AI)가 "왜 이렇게 했지?"를 알 수 없어 임의로 변경하는 문제
- 기술 부채가 쌓여도 근거 없이 리팩토링되는 상황

## Decision
ADR(Architecture Decision Records)을 도입하여 주요 아키텍처 결정을 문서화한다.

### ADR 작성 기준
다음 상황에서 ADR 작성 필수:
1. DB 스키마 변경
2. 새로운 라이브러리/프레임워크 도입
3. 기존 패턴 변경 (예: 상태관리 방식)
4. 폴더 구조 재구성
5. API 계약 변경

### ADR 템플릿
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
1. [대안 1]: [왜 선택하지 않았는지]
2. [대안 2]: [왜 선택하지 않았는지]
```

### 파일명 규칙
`adr/XXXX-kebab-case-title.md`
- 예: `adr/0002-custom-authentication-system.md`

## Consequences

### Pros
- 결정의 근거가 영구히 보존됨
- 새로운 팀원/AI가 컨텍스트를 빠르게 파악
- "왜 이렇게 했지?" 질문에 문서로 답변 가능
- 잘못된 리팩토링 방지

### Cons
- 문서 작성에 시간 소요
- 문서 관리 부담 증가

## Alternatives Considered
1. **코드 주석으로 관리**: 코드와 함께 있어 좋지만, 큰 결정은 파편화됨
2. **Wiki 사용**: 코드베이스와 분리되어 동기화 어려움
3. **문서 없음**: 컨텍스트 손실 위험 높음

---

## 참고
- [ADR GitHub](https://adr.github.io/)
- [Michael Nygard의 원글](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
