# Claude Code Agents & Skills 가이드

> Claude Code가 작업 수행 시 자율적으로 Skills와 Subagents를 활용하고, 필요시 새로 생성하기 위한 가이드입니다.

## 개요

### Skills vs Subagents

| 구분 | Skills | Subagents |
|------|--------|-----------|
| **위치** | `.claude/skills/{name}/SKILL.md` | `.claude/agents/{name}.md` |
| **실행 컨텍스트** | 메인 대화에서 실행 | 별도 컨텍스트에서 실행 |
| **활성화** | description 매칭 시 자동 | 명시적 요청 또는 위임 |
| **용도** | 지식/가이드 제공 | 독립적 작업 수행 |
| **도구 제한** | `allowed-tools` | `tools`, `disallowedTools` |

---

## 현재 사용 가능한 Skills

### 1. `supabase-edge-function`
- **트리거**: Edge Function 생성, 수정, Supabase 함수 관련 질문
- **제공**: CORS 패턴, actor 검증, 응답 형식, 보안 규칙
- **사용 예**: "새 Edge Function 만들어줘", "board-create 함수 수정해줘"

### 2. `expo-component`
- **트리거**: React Native 컴포넌트 생성, UI 수정, 스타일링
- **제공**: 디자인 시스템, 컴포넌트 패턴, 애니메이션 가이드
- **사용 예**: "새 화면 추가해줘", "컴포넌트 만들어줘"

### 3. `fc-workflow`
- **트리거**: FC 상태, 온보딩 프로세스, 권한 관련 질문
- **제공**: 상태 흐름도, 역할별 권한, 인증 플로우
- **사용 예**: "FC 상태가 뭐가 있어?", "Manager 권한은?"

### 4. `rls-policy`
- **트리거**: RLS 정책, Supabase 보안, 권한 제어
- **제공**: RLS 패턴, 스토리지 정책, 디버깅 방법
- **사용 예**: "RLS 정책 추가해줘", "테이블 보안 설정"

---

## 현재 사용 가능한 Subagents

### 1. `edge-function-tester` (Haiku)
- **용도**: Edge Function 테스트 및 검증
- **도구**: Bash, Read, Grep, Glob
- **언제 사용**: Edge Function 작성 후 테스트 필요 시
- **호출**: "edge-function-tester로 {함수명} 테스트해줘"

### 2. `db-schema-reader` (Haiku)
- **용도**: DB 스키마 분석 (읽기 전용)
- **도구**: Read, Grep, Glob
- **언제 사용**: 테이블 구조 파악, 관계 분석 필요 시
- **호출**: "db-schema-reader로 {테이블} 분석해줘"

### 3. `mobile-debugger` (Sonnet)
- **용도**: Expo/React Native 앱 디버깅
- **도구**: Read, Edit, Bash, Grep, Glob
- **언제 사용**: 모바일 앱 에러, 크래시, 성능 이슈 시
- **호출**: "mobile-debugger로 이 에러 분석해줘"

### 4. `vercel-deployer` (Haiku)
- **용도**: Vercel 배포 및 빌드 관리
- **도구**: Bash, Read, Grep
- **언제 사용**: 웹 앱 배포, 빌드 에러 해결 시
- **호출**: "vercel-deployer로 배포해줘"

### 5. `code-reviewer` (Sonnet)
- **용도**: 코드 품질, 보안, 성능 리뷰
- **도구**: Read, Grep, Glob, Bash
- **언제 사용**: 코드 작성 후 리뷰 필요 시 (자동 권장)
- **호출**: "code-reviewer로 리뷰해줘"

---

## 자율적 활용 가이드

### Skills 자동 활용

Claude Code는 다음 상황에서 자동으로 관련 Skill을 활성화합니다:

```
사용자 요청 → description 매칭 → Skill 로드 → 지식 적용
```

**활용 원칙:**
1. 요청이 Skill description과 매칭되면 자동 적용
2. 여러 Skill이 관련되면 모두 참조 가능
3. Skill의 `allowed-tools`를 존중

### Subagents 위임 기준

다음 상황에서 Subagent에 작업을 위임합니다:

| 상황 | 권장 Agent |
|------|------------|
| Edge Function 작성 후 | `edge-function-tester` |
| DB 구조 파악 필요 | `db-schema-reader` |
| 앱 에러/크래시 발생 | `mobile-debugger` |
| 웹 배포 필요 | `vercel-deployer` |
| 코드 변경 완료 후 | `code-reviewer` |

**위임 원칙:**
1. 컨텍스트 격리가 필요한 작업 → Subagent
2. 대량 출력 예상 → Subagent (결과만 반환)
3. 병렬 처리 가능 → 여러 Subagent 동시 실행
4. 빠른 응답 필요 → Haiku 모델 Agent 사용

---

## 새 Skill 생성 가이드

### 언제 새 Skill을 만드는가?

1. **반복되는 패턴**: 같은 유형의 작업이 자주 요청될 때
2. **프로젝트 특화 지식**: 코드베이스 고유의 규칙/패턴이 있을 때
3. **복잡한 가이드**: 여러 단계의 절차가 필요한 작업

### Skill 생성 템플릿

```markdown
---
name: {skill-name}
description: {언제 사용할지 명확하게}. {트리거 키워드 포함}.
allowed-tools: Read, Write, Edit, Grep, Glob
---

# {Skill 제목}

## 개요
{이 Skill이 제공하는 지식/가이드 설명}

## 핵심 패턴
{코드 예시, 규칙, 절차}

## 체크리스트
- [ ] {확인 항목 1}
- [ ] {확인 항목 2}

## 참고 파일
- `path/to/example.ts` - {설명}
```

### 생성 명령

```bash
mkdir -p .claude/skills/{skill-name}
# SKILL.md 파일 작성
```

---

## 새 Subagent 생성 가이드

### 언제 새 Subagent를 만드는가?

1. **독립적 작업**: 메인 컨텍스트와 분리가 필요한 작업
2. **특화된 도구**: 특정 도구 조합만 필요한 작업
3. **반복 자동화**: 자주 수행하는 독립적 작업
4. **비용 최적화**: Haiku로 충분한 단순 작업

### Subagent 생성 템플릿

```markdown
---
name: {agent-name}
description: {역할 설명}. {언제 사용할지}. {proactively 포함 시 자동 위임}.
tools: Read, Edit, Bash, Grep, Glob
model: haiku | sonnet | opus
---

# {Agent 역할}

{Agent의 전문 분야와 역할 설명}

## 역할
1. {주요 역할 1}
2. {주요 역할 2}

## 작업 프로세스
1. {단계 1}
2. {단계 2}

## 출력 형식
{결과물 형식 정의}
```

### 모델 선택 기준

| 모델 | 사용 상황 |
|------|----------|
| `haiku` | 빠른 응답, 단순 분석, 읽기 전용 |
| `sonnet` | 복잡한 분석, 코드 수정, 디버깅 |
| `opus` | 고도의 추론, 아키텍처 설계 |
| `inherit` | 메인 대화와 동일 모델 |

### 도구 제한 패턴

```yaml
# 읽기 전용 (분석용)
tools: Read, Grep, Glob

# 읽기 + 실행 (테스트용)
tools: Read, Bash, Grep, Glob

# 전체 (수정 가능)
tools: Read, Write, Edit, Bash, Grep, Glob

# 특정 도구 제외
tools: Read, Write, Edit, Bash, Grep, Glob
disallowedTools: Bash
```

---

## 권장 워크플로우

### 기능 개발 시

```
1. 요구사항 분석
   └─ Skills: fc-workflow (상태 이해)

2. 설계
   └─ Subagent: db-schema-reader (스키마 파악)

3. 구현
   └─ Skills: supabase-edge-function, expo-component

4. 테스트
   └─ Subagent: edge-function-tester

5. 리뷰
   └─ Subagent: code-reviewer

6. 배포
   └─ Subagent: vercel-deployer
```

### 버그 수정 시

```
1. 에러 분석
   └─ Subagent: mobile-debugger

2. 코드 수정
   └─ Skills: 관련 Skill 자동 적용

3. 검증
   └─ Subagent: edge-function-tester / code-reviewer
```

### 새 패턴 발견 시

```
1. 패턴이 3회 이상 반복됨을 인식
2. 새 Skill 또는 Subagent 필요성 판단
3. 템플릿에 따라 생성
4. 즉시 활용 시작
```

---

## 자동 생성 트리거

Claude Code가 다음 상황을 감지하면 새 Skill/Subagent 생성을 제안합니다:

### Skill 생성 제안
- 동일한 코드 패턴 설명을 3회 이상 반복
- 프로젝트 고유 규칙을 자주 참조
- 복잡한 절차를 반복적으로 설명

### Subagent 생성 제안
- 특정 유형의 독립 작업이 자주 요청됨
- 긴 출력을 생성하는 분석 작업이 반복
- 특정 도구 조합이 자주 사용됨

---

## 파일 구조

```
.claude/
├── AGENTS_AND_SKILLS.md    # 이 문서
├── agents/
│   ├── code-reviewer.md
│   ├── db-schema-reader.md
│   ├── edge-function-tester.md
│   ├── mobile-debugger.md
│   └── vercel-deployer.md
└── skills/
    ├── expo-component/
    │   └── SKILL.md
    ├── fc-workflow/
    │   └── SKILL.md
    ├── rls-policy/
    │   └── SKILL.md
    └── supabase-edge-function/
        └── SKILL.md
```

---

## 명령어 참조

```bash
# Skills 확인
"What Skills are available?"

# Agents 확인
/agents

# 특정 Agent 사용
"Use {agent-name} to {task}"
"{agent-name}로 {작업} 해줘"

# 새 Skill 생성
mkdir -p .claude/skills/{name} && touch .claude/skills/{name}/SKILL.md

# 새 Agent 생성
touch .claude/agents/{name}.md
```

---

## 주의사항

1. **Subagent는 다른 Subagent를 호출할 수 없음**
2. **Skills는 세션 시작 시 로드됨** (새로 생성 시 재시작 필요)
3. **Subagent는 즉시 사용 가능** (파일 생성 후)
4. **민감 정보는 Skills/Agents에 포함하지 않음**
5. **description이 명확해야 자동 매칭됨**
