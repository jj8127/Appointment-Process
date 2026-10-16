# 통합 메신저 1단계 운영 적용 순서

- 상태: 가람in DB 1~4단계 적용 완료 (2026-10-16). 5단계(실제 메시지 복사 확인)와 6~8단계(Edge 배포, 가람Link, 7일 관찰)가 남아 있다.
- 앱 영향: 없음. 앱은 아직 통합 모델을 읽지 않는다. 새 테이블·함수·예약 작업만 생기고, 옛 채팅 테이블에는 실패해도 원래 쓰기를 막지 않는 복사 trigger가 붙는다.
- 리허설: 운영 복원본에서 백필 0.8초, 재실행 0.5초, 대조 통과, 이중 기록 점검 통과 (설계안 문서의 "백필 리허설 결과").

## 브랜치

| 저장소 | 배포용 브랜치 | 구성 |
| --- | --- | --- |
| 가람in | `release/messenger-stage1-20261016` | 운영 DB 라인 `d0eff66` + 메신저 지연 측정(`6846672`, `2a40816`, 운영 OTA `217ef79a`와 같은 코드) + 1단계 커밋 9개 |
| 가람Link | 정해야 함 (아래 사전 확인 2) | 운영 배포 커밋 + 내보내기 커밋 `d185151`, `6687a5d` |

- 운영 DB의 마지막 마이그레이션은 `20261016090000_platform_insurance_only_withdrawal`이고 `d0eff66`에 들어 있다. 1단계 마이그레이션 7개(`20261016104031`~`20261016120000`)는 그 뒤에 붙는다. 파일 이름은 운영에 기록된 적용 버전과 같다.

## 2026-10-16 적용 기록

| 단계 | 결과 |
| --- | --- |
| 사전 확인 | pg_cron 1.6.4, pg_net 0.19.5, 1단계 객체 없음, DB 93MB |
| 2 | `104031` 모델, `104248` 백필 함수와 복사 trigger를 MCP로 적용. 테이블 15개, trigger 6개, 복사 0건 |
| 3 | `110000`~`110200`은 Supabase MCP 서버의 위험 문장 확인이 이 앱에 뜨지 않아 자동 거절됐다. `scripts/ops/messenger-stage1-step3.sql`을 대시보드 SQL 편집기에서 실행했다. 예약 작업 2개, 비공개 bucket, 가져오기 커서 테이블이 생겼다 |
| 4 | `messenger_daily_sync_v1()` 1.6초, 대조 통과. 사람 793, 방 523(org_room 504, direct 18, group 1), 1:1 복사 65건(번호로 넣은 16건 포함), 단체방 126건, 설정 23건. 미해결 이슈는 기록만 하기로 한 66건(삭제 35, 상대 없음 30, 빈 스레드 1) |
| 봇 시험 | 테스트 FC와 개발자 계정으로 6회 자동 실행(`scripts/ops/run-messenger-bot.ps1`). 전송 확정 1.1~2.8초(첨부 2.8초), 상대 서버 도착 0.7~1.4초, 읽음 확인 0.8~1.2초, 실패 0. 새로 생긴 1:1 스레드가 복사되지 않는 문제를 찾았다 |
| 수정 | 백필 뒤에 생긴 1:1 스레드·단체방은 다음 날 백필까지 복사되지 않았다. `111950`(MCP 적용)로 첫 메시지에서 방을 연결해 채우게 했고, 봇 스레드 6건(삭제 2, 첨부 1 포함)이 복사되고 대조가 통과했다 |
| 수정 | 본부장 9명 중 7명은 소속이 추천용 그림자 프로필에만 있어 본부에서 빠졌다. `120000`(`scripts/ops/messenger-stage1-hq-fix.sql`)을 SQL 편집기로 적용한 뒤 본부장 9명 모두 배정됐다(1·2·3·6·7·8·9본부) |

- 앞으로 운영 SQL 중 `truncate`·`delete`·`drop`이 들어간 것은 Supabase MCP가 확인을 요구하고, 이 앱에서는 자동 거절된다. SQL 편집기용 파일로 넘긴다.
- 기존 Edge 함수(`fc-notify`, `group-chat` 등)는 이번에 배포하지 않는다. 운영 Edge 원본은 `deploy/messenger-latency-sentat-20261016`(`8d7e3d6`)에 있고, 저장소 라인과 아직 다르다. 이번에는 새 함수 `messenger-garamlink-sync`만 배포한다.
- `release/all-surfaces-20261004`의 `d9ecad3`은 `6846672`의 이전 판이라 합치지 않는다.

## 사전 확인

1. 가람in 백업: Dashboard → Database → Backups에 오늘 날짜 백업이 있는지 확인하고, 그 시각을 기록한다.
2. 가람Link 운영 커밋: Vercel → request_board → Deployments → Production 행의 커밋을 확인한다.
   - 내보내기 커밋 두 개를 그 커밋 위로 옮긴 브랜치에서만 배포한다.
   - 현재 내보내기 브랜치의 기반 `e55e94f`에는 운영에 나가지 않은 변경(제휴 계정 정리, password sync v2)이 있어서 그대로 배포하지 않는다.
3. 가람in DB 확장: `select extname from pg_extension where extname in ('pg_cron','pg_net');` 결과가 둘 다 나와야 한다.
4. 마지막 마이그레이션이 `20261016090000`인지 확인한다.

## 적용 순서

각 단계 뒤의 확인이 통과해야 다음 단계로 간다. 문제가 생기면 "되돌리기"의 해당 수준으로 돌린다.

| 단계 | 할 일 | 확인 | 문제 시 |
| --- | --- | --- | --- |
| 1 | 가람Link 서버 배포 (내보내기 API). 처음에는 토큰을 넣지 않는다 | `GET /api/messenger-export`가 503 | Vercel에서 이전 배포로 Promote |
| 2 | 가람in 마이그레이션 `20261016104031`, `100100` 적용 (모델, 백필 함수, 복사 trigger) | 테이블 16개 생성. 옛 1:1·단체방 보내기가 그대로 됨 (아직 연결된 방이 없어 복사 없음) | 되돌리기 2 |
| 3 | 마이그레이션 `100200`, `100300`, `100400` 적용 (매일 작업, 가람Link 가져오기, 마무리, bucket) | `cron.job`에 `messenger-unified-daily-sync`, `messenger-garamlink-sync`가 있음. Vault 키가 없어 가져오기는 아직 아무것도 하지 않음 | 되돌리기 1 또는 2 |
| 4 | `select public.messenger_daily_sync_v1();` 한 번 실행 | `ok: true`. 리허설과 비슷한 건수(사람 약 790, 방 약 520). `messenger_sync_issues` 미해결 건이 리허설 기록과 같은 종류뿐 | 되돌리기 2 (복사본은 남겨도 무해) |
| 5 | 실제 앱에서 1:1·단체방 메시지 한 건씩 보내기 (본인 계정끼리) | `messenger_messages`에 바로 복사됨 | 되돌리기 2 |
| 6 | Edge `messenger-garamlink-sync` 배포 + secret 3개 (`REQUEST_BOARD_MESSENGER_EXPORT_URL`, `_TOKEN`, `REQUEST_BOARD_STORAGE_ORIGIN`). 가람Link에 `FC_ONBOARDING_MESSENGER_EXPORT_TOKEN` 같은 값 설정 | 서비스 키로 한 번 호출 → `ok: true`, `messenger_import_cursors`에 `request_board` 행, `last_error` 비어 있음 | 되돌리기 1 (토큰 제거) |
| 7 | Vault에 `messenger_garamlink_sync_service_key` 등록 (값 = Edge의 `SUPABASE_SERVICE_ROLE_KEY`) | 10분 뒤 `net._http_response` status 200, 커서가 움직임 | Vault secret 삭제 |
| 8 | 7일 관찰 | 매일 아래 점검 쿼리 | 아래 "멈춤 기준" |

## 매일 점검 (관문: 7일 연속 통과)

```sql
select public.messenger_reconcile_streak_v1() as streak;           -- 7 이상이면 관문 통과
select ran_at, ok, result->'openIssues' from messenger_reconcile_runs order by ran_at desc limit 3;
select reason, count(*) from messenger_sync_issues where resolved_at is null group by 1 order by 2 desc;
select source, last_imported_at, batches, messages, last_error, last_error_at from messenger_import_cursors;
```

멈춤 기준:
- 대조 실패가 이틀 연속이면 되돌리기 1로 멈추고 원인을 본다.
- 옛 채팅 쓰기 오류가 늘면 즉시 되돌리기 2를 한다. trigger는 실패해도 쓰기를 막지 않지만, 느려질 수 있다.
- 가져오기 `last_error`가 1시간 넘게 남아 있으면 Vault secret을 지워 가져오기만 멈춘다.

## 되돌리기 (`scripts/ops/messenger-stage1-rollback.sql`)

| 수준 | 하는 일 | 언제 |
| --- | --- | --- |
| 1 멈춤 | 예약 작업 두 개 해제, 가져오기 토큰 제거 | 대조 실패, 가져오기 오류 |
| 2 분리 | 1 + 옛 테이블의 복사 trigger 제거 | 옛 채팅에 조금이라도 영향이 보일 때 |
| 3 제거 | 2 + 1단계 테이블·함수 삭제, bucket·Edge 함수·Vault secret 정리 | 1단계를 포기할 때만 |

- 어느 수준도 옛 채팅 데이터는 건드리지 않는다. 앱은 통합 모델을 읽지 않으므로 사용자 영향이 없다.
- 3 이후 다시 시작하려면 마이그레이션 7개를 다시 적용하고 `messenger_daily_sync_v1()`을 실행하면 옛 테이블에서 다시 채워진다. PGlite 테스트로 확인했다.
- 지운 함수는 이번 마이그레이션이 만든 44개뿐이다. 그 전부터 있던 `messenger_*` 객체(첨부, 방 허브, 검색, 방 알림 설정)는 남는다.

## 운영자 정리 작업 (관문과 별개)

- 상대가 없는 1:1 메시지는 처음 기록되고 30일 뒤에 지운다.
  - 목록 확인: `select * from messenger_orphan_purge_candidates_v1();`
  - 삭제: `select messenger_purge_orphan_messages_v1(<목록 건수>);`
- 본부를 읽을 수 없는 본부장(`headquarters_unknown`)은 소속 표기를 고쳐 주면 다음 날 자동으로 들어간다.
