# SuperClaude 기능 가이드

SuperClaude는 Claude Code CLI에 추가 기능을 제공하는 확장 도구입니다.

## 설치 정보

- **버전**: 4.1.9
- **설치 위치**: `C:\Users\jj812\.claude\commands\sc`
- **설치 방법**: pipx를 통한 PyPI 설치

## Slash Commands (31개)

SuperClaude는 31개의 슬래시 명령어를 제공합니다. 채팅창에서 `/` 입력 시 자동완성으로 사용 가능합니다.

### 개발 & 코드 관련

#### `/agent`
- AI 에이전트 생성 및 관리
- 특정 작업을 수행하는 자율 에이전트 실행

#### `/analyze`
- 코드베이스 종합 분석
- 코드 품질, 보안, 성능, 아키텍처 도메인 전반 분석

#### `/build`
- 빌드, 컴파일, 패키징 작업
- 지능형 에러 처리 및 최적화 포함

#### `/cleanup`
- 코드 정리 및 최적화
- 데드 코드 제거, 프로젝트 구조 개선

#### `/design`
- 시스템 아키텍처, API, 컴포넌트 인터페이스 설계
- 포괄적인 스펙 문서 생성

#### `/explain`
- 코드, 개념, 시스템 동작 설명
- 교육적이고 명확한 설명 제공

#### `/implement`
- 기능 및 코드 구현
- 지능형 페르소나 활성화 및 MCP 통합

#### `/improve`
- 코드 품질, 성능, 유지보수성 체계적 개선
- 리팩토링 및 최적화 제안

#### `/test`
- 테스트 실행, 커버리지 분석
- 자동화된 품질 리포팅

#### `/troubleshoot`
- 코드, 빌드, 배포, 시스템 동작 문제 진단 및 해결
- 버그 수정 및 디버깅

### 프로젝트 관리

#### `/pm`
- 프로젝트 매니저 에이전트 (기본 오케스트레이션)
- 모든 하위 에이전트 조정 및 워크플로우 관리

#### `/task`
- 복잡한 작업 실행
- 지능형 워크플로우 관리 및 위임

#### `/workflow`
- PRD 및 기능 요구사항으로부터 구조화된 구현 워크플로우 생성

#### `/estimate`
- 작업, 기능, 프로젝트 개발 추정치 제공
- 지능형 분석 기반

#### `/brainstorm`
- 소크라테스식 대화를 통한 인터랙티브 요구사항 발견
- 체계적인 탐색

### 문서화

#### `/document`
- 컴포넌트, 함수, API, 기능에 대한 집중적 문서 생성
- 명확하고 구조화된 문서화

#### `/spec-panel`
- 멀티 전문가 스펙 리뷰 및 개선
- 저명한 스펙 및 소프트웨어 엔지니어링 전문가 활용

#### `/business-panel`
- 비즈니스 패널 분석 시스템
- 비즈니스 요구사항 및 전략 분석

### Git 관련

#### `/git`
- Git 작업 수행
- 지능형 커밋 메시지 및 워크플로우 최적화

### 리서치 & 분석

#### `/research`
- 웹에서 깊은 리서치 수행
- 적응형 계획 및 지능형 검색

#### `/reflect`
- 작업 회고 및 검증
- Serena MCP 분석 기능 사용

#### `/recommend`
- 초지능형 명령어 추천 엔진
- 사용자 입력에 가장 적합한 SuperClaude 명령어 추천

### 데이터 관리

#### `/index`
- 프로젝트 문서 및 지식 베이스 생성
- 지능형 조직화

#### `/index-repo`
- 리포지토리 인덱싱
- 94% 토큰 감소 (58K → 3K)

#### `/load`
- 세션 라이프사이클 관리
- Serena MCP 통합을 통한 프로젝트 컨텍스트 로딩

#### `/save`
- 세션 라이프사이클 관리
- Serena MCP 통합을 통한 세션 컨텍스트 지속성

### 메타 시스템

#### `/spawn`
- 메타 시스템 작업 오케스트레이션
- 지능형 작업 분해 및 위임

#### `/select-tool`
- 복잡도 점수 및 작업 분석 기반 지능형 MCP 도구 선택

#### `/sc`
- SuperClaude 명령어 디스패처
- `/sc [command]`로 모든 SuperClaude 기능 접근

### 기타

#### `/help`
- 사용 가능한 모든 `/sc` 명령어 및 기능 나열
- 도움말 및 사용법 안내

#### `/README`
- SuperClaude 명령어 개요
- 프로젝트 README 생성 지원

## MCP Servers (Model Context Protocol)

SuperClaude는 MCP 서버 통합을 지원합니다. 현재 프로젝트에 설치된 서버:

### 설치된 MCP 서버

#### 1. sequential-thinking ✅
- **기능**: 다단계 문제 해결 및 체계적 분석
- **위치**: 글로벌 설정 (모든 프로젝트에서 사용 가능)
- **명령어**: `npx -y @modelcontextprotocol/server-sequential-thinking`
- **용도**: 복잡한 문제를 단계별로 분석하고 해결
- **특징**:
  - 사고의 연쇄(Chain of Thought) 추론
  - 가설 생성 및 검증
  - 재귀적 문제 해결
  - 브랜칭 및 수정 가능

#### 2. playwright ✅
- **기능**: 크로스 브라우저 E2E 테스트 및 자동화
- **위치**: 현재 프로젝트 (`e:/hanhwa/fc-onboarding-app`)
- **명령어**: `npx -y playwright-mcp`
- **용도**: 브라우저 자동화, E2E 테스트 실행, 웹 페이지 스크래핑
- **특징**:
  - 브라우저 초기화 및 네비게이션
  - DOM 검사 및 상호작용
  - 스크린샷 캡처
  - 커스텀 JavaScript 실행

#### 3. filesystem ✅
- **기능**: 프로젝트 파일시스템 접근 및 조작
- **위치**: 현재 프로젝트 (`e:/hanhwa/fc-onboarding-app`)
- **명령어**: `npx -y @modelcontextprotocol/server-filesystem e:/hanhwa/fc-onboarding-app`
- **용도**: 파일 읽기/쓰기, 디렉토리 탐색, 파일 검색
- **특징**:
  - 안전한 파일 시스템 접근
  - 파일 내용 읽기/수정
  - 디렉토리 구조 탐색
  - 파일 검색 및 필터링

#### 4. github ✅
- **기능**: GitHub 리포지토리 통합
- **위치**: 현재 프로젝트
- **명령어**: `npx -y @modelcontextprotocol/server-github`
- **용도**: Issue 관리, PR 생성, 코드 리뷰, 리포지토리 정보 조회
- **특징**:
  - Issue 생성/조회/업데이트
  - Pull Request 관리
  - 브랜치 및 커밋 조회
  - 리포지토리 메타데이터

#### 5. memory ✅
- **기능**: 세션 간 지속적인 메모리 관리
- **위치**: 현재 프로젝트
- **명령어**: `npx -y @modelcontextprotocol/server-memory`
- **용도**: 대화 컨텍스트 저장, 프로젝트 정보 기억, 사용자 선호도 저장
- **특징**:
  - 키-값 기반 영구 저장
  - 세션 간 정보 유지
  - 컨텍스트 누적 관리
  - 프로젝트별 메모리 분리

### 사용 가능한 MCP 서버 (미설치)

#### context7 (npm 패키지 미공개)
- **기능**: 공식 라이브러리 문서 및 코드 예제
- **용도**: 최신 라이브러리 문서 및 API 참조
- **상태**: 아직 npm에 공개되지 않음, 향후 사용 가능 예정

#### magic (API 키 필요: TWENTYFIRST_API_KEY)
- **기능**: 모던 UI 컴포넌트 생성 및 디자인 시스템
- **용도**: UI 컴포넌트 자동 생성

#### serena (uv 패키지 매니저 필요)
- **기능**: 시맨틱 코드 분석 및 지능형 편집
- **용도**: 고급 코드 분석 및 리팩토링

#### tavily (API 키 필요: TAVILY_API_KEY)
- **기능**: 웹 검색 및 실시간 정보 검색
- **용도**: 깊은 리서치 및 최신 정보 조회

#### morphllm-fast-apply (API 키 필요: MORPH_API_KEY)
- **기능**: 컨텍스트 인식 코드 수정
- **용도**: 빠른 코드 변경 적용

#### chrome-devtools
- **기능**: Chrome DevTools 디버깅 및 성능 분석
- **용도**: 브라우저 디버깅 및 프로파일링

## 사용 방법

### Slash Commands 사용

1. Claude Code 채팅창에서 `/` 입력
2. 자동완성 목록에서 원하는 명령어 선택
3. 필요한 경우 추가 인자 제공

```
/analyze
/implement 사용자 인증 기능
/git 커밋 메시지 작성
```

### MCP 서버 활용

MCP 서버는 자동으로 대화 컨텍스트에 통합됩니다. Claude가 필요할 때 자동으로 해당 도구를 사용합니다.

예시:
- 복잡한 로직 설명 요청 시 → sequential-thinking 자동 활성화
- 브라우저 테스트 요청 시 → playwright 자동 활성화

## 관리 명령어

### SuperClaude 명령어 관리

```bash
# 설치된 명령어 목록 확인
superclaude install --list

# 명령어 재설치
superclaude install

# 상태 체크
superclaude doctor
```

### MCP 서버 관리

```bash
# MCP 서버 목록 확인
claude mcp list

# MCP 서버 추가
claude mcp add --transport stdio <server-name> -- <command>

# MCP 서버 제거
claude mcp remove <server-name>

# 사용 가능한 MCP 서버 확인
superclaude mcp --list
```

## 설치 및 설정

### 초기 설치

```bash
# SuperClaude 설치
pipx install superclaude

# Slash Commands 설치
superclaude install

# MCP 서버 설치 (선택사항)
superclaude mcp --list  # 사용 가능한 서버 확인
claude mcp add --transport stdio sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking
```

### 업데이트

```bash
# SuperClaude 업데이트
pipx upgrade superclaude

# 명령어 재설치
superclaude install
```

## 주의사항

1. **Claude Code 재시작**: 새 명령어나 MCP 서버 설치 후 반드시 Claude Code를 재시작해야 합니다.

2. **Windows 인코딩 이슈**: Windows에서 일부 SuperClaude 명령어 실행 시 UTF-8 인코딩 문제가 발생할 수 있습니다. 이 경우 Claude CLI를 직접 사용하세요.

3. **API 키 필요**: 일부 MCP 서버(magic, tavily, morphllm)는 API 키가 필요합니다. 환경 변수로 설정해야 합니다.

4. **NPM 의존성**: 대부분의 MCP 서버는 npx를 통해 실행되므로 Node.js 및 npm 설치가 필요합니다.

## 트러블슈팅

### MCP 서버 연결 실패

```bash
# MCP 서버 상태 확인
claude mcp list

# 연결 실패한 서버 제거 후 재설치
claude mcp remove <server-name>
claude mcp add --transport stdio <server-name> -- <command>
```

### 명령어가 표시되지 않음

1. Claude Code 완전 재시작
2. 설치 확인: `superclaude install --list`
3. 재설치: `superclaude install`

### Windows 경로 문제

```bash
# PowerShell을 통한 실행
powershell -Command "& 'C:\Users\<username>\pipx\venvs\superclaude\Scripts\superclaude.exe' <command>"
```

## 추가 리소스

- **공식 문서**: [SuperClaude GitHub](https://github.com/cyanheads/superclaude)
- **MCP 프로토콜**: [Model Context Protocol](https://modelcontextprotocol.io/)
- **Claude Code**: [Claude CLI Documentation](https://docs.anthropic.com/en/docs/build-with-claude/claude-code)

## 업데이트 이력

- **2026-01-09 (오후)**: MCP 서버 확장 - filesystem, github, memory 서버 추가 (총 5개 활성화)
- **2026-01-09 (오전)**: SuperClaude 4.1.9 설치, 31개 슬래시 명령어 및 2개 MCP 서버 (sequential-thinking, playwright) 활성화

## MCP 서버 활용 예시

### Sequential Thinking
```
복잡한 알고리즘 문제를 단계별로 분석해주세요:
[문제 설명]
```
→ Sequential thinking MCP가 자동으로 활성화되어 체계적 분석 제공

### Filesystem
```
프로젝트의 모든 TypeScript 파일에서 특정 패턴을 찾아주세요
```
→ Filesystem MCP가 파일 시스템을 효율적으로 탐색

### GitHub
```
이번 주에 생성된 모든 이슈를 요약해주세요
```
→ GitHub MCP가 리포지토리 정보를 조회

### Memory
```
이 프로젝트의 주요 아키텍처 결정사항을 기억해주세요
```
→ Memory MCP가 정보를 영구 저장하여 다음 세션에서도 활용
