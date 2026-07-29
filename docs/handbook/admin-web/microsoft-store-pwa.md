doc_id: FC-ADMIN-MICROSOFT-STORE-PWA
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: developer, operator
last_verified: 2026-07-29
source_of_truth: web/src/app/manifest.ts + web/public/sw.js + Partner Center product identity

# 관리자 웹 Microsoft Store PWA

## 배포 형태

- 관리자 웹은 운영 HTTPS URL을 사용하는 PWA로 Microsoft Store에 배포한다.
- 시작 경로는 `/auth`, 앱 범위는 `/`, 표시 모드는 `standalone`이다.
- 웹 앱 이름은 `가람in 관리자`, 기본 언어는 `ko-KR`이다.
- Store 패키지는 PWABuilder에서 생성하되, 실제 상품에 예약된 identity만 사용한다.

## 설치 가능성 계약

- Next.js metadata route가 `/manifest.webmanifest`를 제공한다.
- 운영 secure context에서는 로그인이나 알림 권한 요청 전에 `/sw.js`를 등록한다.
- 서비스워커 등록 자체는 알림 권한을 요청하지 않는다.
- 기존 Web Push 수신과 알림 클릭 딥링크 로직을 보존한다.
- 인증 HTML, API 응답, 주민번호, 주소, 첨부파일은 Cache Storage에 저장하지 않는다.
- 일반 GET은 network-only이고, 탐색 요청이 오프라인일 때만 고정 안내 HTML을 반환한다.

## Store identity gate

Microsoft Store 업로드용 MSIX 생성에는 Partner Center의 해당 상품에서 복사한 다음 값이 모두 필요하다.

1. Package ID
2. Publisher ID
3. Publisher display name

2026-07-29 기준 Partner Center에는 `가람Link` 상품만 있고 관리자 웹 상품은 없다. 관리자 웹 상품을 예약하기 전에는 임의 Package ID로 업로드 후보를 만들지 않는다. 상품 예약, 패키지 업로드, 비공개 대상 배포, 제출은 각각 별도 외부 변경이다.

## 검증

```powershell
Set-Location D:\hanhwa\fc-onboarding-app\web
node --experimental-strip-types --test src/lib/admin-pwa-contract.test.ts src/lib/notification-navigation-source.test.ts
npx tsc --noEmit
npm run lint

$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
$env:SENTRY_DISABLE_UPLOAD = '1'
$env:SENTRY_AUTH_TOKEN = ''
npm run build
```

빌드 후 다음을 확인한다.

- `/manifest.webmanifest`, `/sw.js`, `/store-icon.png`, `/auth`가 200을 반환한다.
- `/auth` 문서에는 manifest 링크와 theme color가 각각 한 개다.
- 서비스워커에 push/notificationclick 처리와 network-only fetch가 함께 존재한다.
- Cache Storage API 사용이 없다.

운영 배포 후 PWABuilder 검사, 실제 Store identity를 사용한 MSIX 생성, WACK, 비공개 대상 설치·로그인·알림 클릭·로그아웃·오프라인 검증 순으로 진행한다.
