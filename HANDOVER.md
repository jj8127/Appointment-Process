# AI 핸드오버 가이드

> 이 문서는 새 AI 세션에서 일관된 개발을 위한 프로토콜입니다.

---

## 1. 문서 구조

```
fc-onboarding-app/
├── .cursorrules          # 핵심 규칙 (AI 필수 준수)
├── AI.md                 # 상세 개발 가이드
├── context.md            # 현재 세션 상태
├── HANDOVER.md           # 이 파일 (핸드오버 프로토콜)
├── CLAUDE.md             # 프로젝트 개요 (Claude Code용)
├── contracts/            # API/DB/컴포넌트 계약
│   ├── database-schema.md
│   ├── api-contracts.md
│   └── component-contracts.md
└── adr/                  # 아키텍처 결정 기록
    ├── README.md
    ├── 0001-record-architecture-decisions.md
    ├── 0002-custom-authentication-system.md
    └── 0003-theme-system-and-reusable-components.md
```

### 우선순위 (Source of Truth)
1. 기존 코드/테스트 (실행되는 코드가 진실)
2. contracts/ (스키마, 타입, API 계약)
3. adr/ (아키텍처 결정 기록)
4. AI.md (상세 규칙)
5. 사용자의 추가 요청

---

## 2. 세션 시작 프롬프트 (복붙용)

새 채팅 시작 시 아래 프롬프트를 사용하세요:

```text
새 세션 시작. 아래 문서가 프로젝트의 단일 진실(Single Source of Truth)이다.

우선순위:
1. 기존 코드/테스트
2. contracts/ (스키마, API 계약)
3. adr/ (아키텍처 결정)
4. AI.md (개발 규칙)
5. 내 메시지의 추가 요구사항

규칙:
- 기존 구조/네이밍/패턴을 임의로 바꾸지 말 것
- 구조/DB/API 변경이 필요하면 먼저 '변경 제안서'를 작성하고 ADR 초안 제시
- 작업은 "계획 → 변경 → 검증 체크리스트" 순서로 출력

[context.md 내용 붙여넣기]

이제 다음 작업: (작업 설명)
```

### 간단 버전 (빠른 시작)
```text
context.md 읽고 이어서 작업해. 기존 패턴 유지하고, 구조 변경은 ADR 먼저.
작업: (작업 설명)
```

---

## 3. 세션 종료 프롬프트 (복붙용)

세션 종료 전 아래 프롬프트로 핸드오버 패킷을 생성하세요:

```text
세션 종료. 다음 세션에서 즉시 이어갈 수 있도록 핸드오버 패킷을 작성해줘.

출력 형식:
1) 이번 세션 변경 요약 (핵심 5줄)
2) 변경 파일 목록 (경로만)
3) 새로 추가/수정된 규칙이 있으면 AI.md에 반영할 문구
4) ADR이 필요한 변경이면 ADR 초안
5) 남은 TODO (우선순위/예상 리스크)
6) 재현/검증 절차 (명령/클릭 경로)
7) 되돌리기 플랜 (rollback) 3줄

그리고 context.md를 업데이트해줘.
```

---

## 4. 핸드오버 패킷 예시

```markdown
## 핸드오버 패킷 - 2025-01-10 세션

### 1. 변경 요약
1. Button 컴포넌트를 4개 화면에 적용 (signup-password, signup-verify, reset-password, apply-gate)
2. LoadingSkeleton을 3개 화면에 적용 (notice, index, dashboard)
3. 약 80줄의 중복 스타일 코드 제거
4. 모든 버튼이 이제 일관된 디자인 시스템 사용
5. 로딩 상태가 스켈레톤 UI로 개선됨

### 2. 변경 파일
- app/signup-password.tsx
- app/signup-verify.tsx
- app/reset-password.tsx
- app/apply-gate.tsx
- app/notice.tsx
- app/index.tsx
- app/dashboard.tsx

### 3. AI.md 추가 규칙
- "버튼은 components/Button.tsx 사용, Pressable 직접 사용 금지" 규칙 추가

### 4. ADR
- ADR 0003 업데이트 (마이그레이션 현황)

### 5. 남은 TODO
1. [높음] 나머지 화면 Button 적용 (consent, identity, docs-upload)
2. [중간] FormInput 추가 적용
3. [낮음] ScreenHeader 통합

### 6. 검증 절차
npm run lint
npx tsc --noEmit
npm start → 각 화면 로딩 상태 확인

### 7. 롤백 플랜
1. git stash 또는 git checkout -- app/
2. Button import 제거하고 Pressable 복원
3. LoadingSkeleton import 제거하고 ActivityIndicator 복원
```

---

## 5. 주요 금지 사항 (Quick Reference)

| 금지 | 대신 사용 |
|------|----------|
| 하드코딩 색상 (#f36f21) | COLORS.primary |
| Pressable 직접 사용 | Button 컴포넌트 |
| TextInput 직접 사용 | FormInput 컴포넌트 |
| ActivityIndicator 단독 | LoadingSkeleton |
| Supabase Auth 사용 | 커스텀 Edge Functions |
| 폴더 구조 변경 | ADR 먼저 작성 |

---

## 6. 빠른 명령어

```bash
# 린트 검사
npm run lint

# 타입 검사
npx tsc --noEmit

# 개발 서버
npm start

# 빌드
eas build --platform android --profile preview
```

---

## 7. 문제 발생 시

### 스타일이 깨졌을 때
1. theme.ts 토큰 사용 여부 확인
2. 기존 화면과 비교
3. contracts/component-contracts.md 참조

### 인증이 안 될 때
1. Edge Function 로그 확인
2. adr/0002-custom-authentication-system.md 참조
3. use-session.tsx 확인

### 구조 변경이 필요할 때
1. ADR 초안 작성
2. 사용자 승인 받기
3. 변경 후 adr/ 폴더에 저장
