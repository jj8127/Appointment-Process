doc_id: FC-APP-SERVICE-HOME
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-10-10
source_of_truth: app/index.tsx + app/services/* + components/ServiceHub.tsx + components/service-home/* + lib/service-home.ts + lib/session-landing.ts + lib/bottom-navigation.ts

# Mobile Playbook: 서비스 선택 홈

## 서비스 홈

기본 `/`는 비회원·FC·운영 담당자가 서비스를 고르는 공개 홈이다. 서비스별 맞춤 PNG는 `assets/images/service-home/`에 있고 `lib/theme.ts`의 기존 가람in 색을 사용한다. 이 홈은 업무용 프로필·게시글·고객·알림 자료를 조회하지 않는다.

기본 시작 화면은 `index`이다. 세션 복구 전에는 브랜드 로딩을 표시하고 복구 뒤 공개 홈을 연다. 저장된 linked designer 세션은 focused 상태에서 알림 네비게이션 결정을 기다린 뒤 `/request-board`로 이동한다. 명시적 `/services`는 모든 역할이 서비스 안내를 둘러보는 경로다.

## 화면 위계

상단은 배경 없는 한화 3원 심볼과 검정 `가람in` 텍스트를 왼쪽에, 기존 로그인/계정을 오른쪽에 배치한다. 투명 원본 `adminWebLogo.png`의 심볼 영역만37.5×34px 뷰 안에 표시하며 원본 픽셀은 수정하지 않는다. 헤더는 흰색, 본문은 기존 테마의 연한 회색 `#f3f4f6`과24px 둥근 상단 경계로 구분한다. 홈 제목은 `좋은 서비스,\n함께 누리는 혜택`이며 두 줄로 표시한다. 가족간병·보험/FC·통신·자동차의 네 메뉴는 같은 크기의 진입 영역과64px 그림 슬롯을 갖는다. FC 업무를 별도의 큰 영역으로 반복하지 않는다. 서비스 아이콘은 각각 coral·blue·indigo·teal 색이며, 원본 Blender 모델의 재질을 변경해 렌더한 로컬 PNG다.

소개 영역은 네 장의 사진이4:3 배너를 가득 채우는 구성이다. 흰색 제목과 좌하단의 짧은 안내·링크를 사진 위에 표시하고, 작은 번호·이전/다음 제어는 이미지 내부 우하단에 둔다. 제어의 시각 크기는96×32px이며 버튼은 hitSlop과44px 높이 부모 영역으로 터치 범위를 확보한다. 사진은 `assets/images/service-home/banners/`에 있고 내장 ImageGen의 생성 프롬프트와 원본 해시는 해당 폴더의 provenance에 기록한다.

손가락 스와이프·마우스 드래그·이전/다음 제어로 이동하며 마지막 장의 다음은 첫 장, 첫 장의 이전은 마지막 장으로 자연스럽게 이어진다. 배너 조작 종료 후5초 동안 새 배너 조작이 없으면 다음 장으로 이동한다. 배너 밖 조작과 단순 호버는 이 시간을 초기화하지 않는다. 웹 화면이 보이는 동안은 창 포커스가 채팅창 등으로 이동해도 자동 순환을 유지한다. 탭이 숨겨지거나 앱이 백그라운드/다른 화면으로 이동한 경우, 조작 중·일시정지·모션 줄이기 설정에서는 자동 이동을 멈춘다. 창의 blur 시 진행 중 드래그를 취소하는 처리는 유지한다. 실제 `onLayout` 폭에 페이지를 맞추고 크기/글꼴 변경에도 선택한 페이지를 유지한다. 활성 페이지의 CTA만 키보드/스크린리더로 접근할 수 있게 하고 순환용 복제 화면은 중복 노출하지 않는다.

가족간병 메뉴와 배너의 `가족간병 알아보기`는 `FAMILY_CARE_PROMOTION_URL`의 기존 공개 페이지 `https://garam-public-web.vercel.app/family-care/`를 사용자 선택 때 연다. 기존 `openExternalUrl`에 명시적인 `sameWindowOnWeb` 옵션을 전달하여 Web은 같은 탭, Native는 기존 앱 내 브라우저/대체 경로를 사용한다. 다른 호출의 기본 동작은 유지한다. 식별자·세션·추천 query를 붙이지 않는다. 열기 실패 시 인터넷 확인·다시 선택 안내를 표시한다. 공개 페이지는 등록 전 조건·서류·보험사 조건과 FAQ·앱 설치를 안내하며 현재 실제 가족간병 등록폼은 없다.

FC 메뉴와 소개 배너는 기존 공통 업무 진입/재개 resolver를 사용한다. 통신·자동차 메뉴와 각 배너는 내부 준비 중 안내 페이지로 이동한다. 실제 구매·신청·보장·페이백을 약속하지 않는다.

상단 그림은56px이고 자동차는 낮고 긴 실루엣을 고려해64px로 보정한다. 배너 사진은 전체 영역을 cover로 채운다. 글꼴 확대 시 배너 높이와 하단 문구 여백을 늘려 제어와 겹치지 않게 한다. 공개 하단 메뉴는 배경 원 없는 선형 아이콘을 쓰며 선택 아이콘만 주황색이다. 기존 역할별 업무 메뉴의 표현과 동작은 유지한다.

## 보험·FC 진입

- 비회원: `/login?service=insurance`으로 이동한다. 로그인 성공 뒤 선택한 보험 업무를 기존 gate를 통해 이어간다. 현재 가입은 FC 업무용이며 로그인에서 `FC 회원가입`으로 표시한다.
- FC: `/apply-gate?next=/?mode=insurance`에 해당하는 params로 이동한다. 기존 identity 완료 확인과 오류·재시도 정책을 거친다.
- 관리자·본부장·개발자: `/?mode=insurance`로 기존 역할별 업무 화면을 연다. manager의 readOnly와 developer subtype 계약은 유지한다.
- linked designer: `/request-board`로 이동한다.

일반 FC 로그인 뒤 기본 landing은 `/`이다. 기존 `home-lite`는 본인확인 이전 제한 화면으로 유지하며, 완료 후 `INSURANCE_HOME_ROUTE`로 돌아간다. 제한 홈의 필수정보 버튼도 apply gate에 같은 `next`를 전달한다. 공개 홈의 보험 CTA는 기존 apply gate가 실제 identity 완료 여부를 확인하게 한다.

로그인은 단일 문자열 `service=insurance`만 선택 의도로 인정한다. FC 식별자·hydration 대기와 `skipAuto` 수동 로그인 조건, 알림 우선순위를 먼저 유지한다. 다른 값·배열은 일반 landing을 사용한다. 계정 생성·최초 비밀번호 변경까지 선택 의도를 보존하는 동작은 이번 변경에 포함하지 않는다.

로그인 화면의 관리자/FC 번호 안내 문구는 제거했다. 안전 영역 상단의44px 뒤로가기 버튼은 `router.replace('/')`로 공개 서비스 홈을 연다. 보험 직접 진입과 세션 복구 전에도 동일하게 작동하며 기존 `서비스 둘러보기`는 유지한다.

## 기존 링크와 알림

`mode=insurance|onboarding|exam` 또는 단일 문자열의 notification receipt 문맥은 `app/index.tsx` 안의 `LegacyInsuranceHome`으로 연결한다. hydration과 로그인 role을 먼저 확인해 공개 branch에서 기존 protected hooks와 count ping을 마운트하지 않는다. 보호된 문맥의 signed-out 상태는 `/login?skipAuto=1`을 사용한다.

알려지지 않은 mode는 서비스 홈이다. query가 역할·권한을 부여하지 않는다. 기존 홈 알림 receipt 처리와 권한 재검증은 그대로 사용한다.

## 서비스 안내와 하단 메뉴

2026-10-10: 보험 서비스의 FC 하단 `홈`은 `INSURANCE_HOME_ROUTE` (`/?mode=insurance`)로 이동한다. 전체 서비스의 `홈`은 `/`다. 보험 홈 상단은 최소44px 높이 한 행에 왼쪽 `보험·FC`, 화면 중앙 `위촉/시험`, 오른쪽 `전체 서비스`를 배치한다. 제목은 좌우 요소의 폭과 무관하게 중앙에 고정하고 기존 글꼴·색·정렬을 유지한다. 기존 중앙 설명은 행 바로 아래에 둔다. 전체 서비스 버튼은 `/`로 돌아간다. 관리자의 위촉/시험과 linked designer preset은 유지한다.

보험 홈과 제한 홈의 Android 시스템 뒤로 가기는 스택에 이전 화면이 있으면 기본 pop을 허용한다. 루트일 때만 앱 종료를 확인한다. 기본정보의 일반 로그인 상태 뒤로 가기와 가입 인증의 이전 단계는 기존 `goBackOrReplace`로 스택을 먼저 사용하고, 직접 진입으로 스택이 없을 때 기존 대체 경로를 사용한다. 기본정보의 미로그인·auth/login 출처 이동은 기존 인증 목적지를 유지한다. 가입 인증에서 가입 폼으로 돌아갈 때 새 폼을 만들지 않아 메모리 입력을 보존한다.

기본정보·보증보험 동의 저장 완료와 서류의 `홈으로 가기`는 `INSURANCE_HOME_ROUTE`를 사용한다. 승인된 서류의 다위촉 목적지는 유지하며, 완료 후 `replace` 동작 자체는 바꾸지 않는다.

보험 홈 하단 메뉴는 항상 표시한다. 화면 데이터 갱신 또는 레이아웃 보정에 따른 onScroll이 사용자 스크롤처럼 hide/show를 반복하지 않도록 이 화면의 독자 숨김 애니메이션을 제거했다. 본문은 하단 메뉴 높이를 위한 여백을 유지한다. 다른 업무 목록의 스크롤 숨김 동작은 이번 수정에 포함하지 않는다. 근거: `components/__tests__/BottomNavigation.test.tsx`, `InsuranceHomeNavigation.test.tsx`.

`services/telecom`, `services/car`는 각각 이동 후 준비 중 상태를 안내한다. `services/care`의 기존 이용 전 확인사항 안내는 호환 경로로 보존하며 홈의 가족간병 선택은 공개 홍보 페이지를 직접 연다. 신청·구매·보험금·페이백을 확정하거나 실제 등록하지 않는다. `services/help`는 공개 안내와 현재 FC 가입 범위를 설명한다.

안내의 네 경로는 `generateStaticParams`로 web export에도 생성한다.

`services/activity`는 통합 이용내역이 준비 중임을 표시하고 기존 보험/FC 진행 화면으로 연결한다. 상단 계정과 하단 내 정보는 모두 `services/account`로 진입한다. 이 화면은 session hydration 뒤 `settings?surface=service-hub` 또는 로그인으로 연결한다. 설정은 이 명시적인 URL surface에서 중앙 resolver의 공개 `service-hub` preset을 사용하므로 하단 홈은 전체 서비스 홈으로 돌아간다. 보험 업무에서 일반 `/settings`로 진입한 경우 기존 역할별 preset을 유지한다. 설정에서 세부 편집으로 이동하고 취소·뒤로 가기 하면 원래 설정 스택의 surface가 유지된다. 이 query는 화면 문맥이며 권한을 부여하지 않는다.

## 제휴서비스 이용료 지급 기획 기준

2026-10-09 사용자에게 전달받은 대표의 설명: 플랫폼은 소비자에게 제휴서비스를 제공하고, 제휴사별 정산이 완료된 시점부터 일주일 이내에 회사가 정한 비율대로 이용료를 지급한다. 통신·간병 등 제휴서비스마다 정산 시점이 다르므로 하나의 공통 월별 지급일이나 이용 즉시 지급으로 안내하지 않는다.

지급 대상·실제 비율·계산 기준·정산 완료 인정 자료·취소와 환불 규칙은 이 설명만으로 추가 확정하지 않는다. 위 내용은 향후 제품 기획 기준이며 현재 공개 홈에 정산 또는 지급 기능이 구현된 상태를 뜻하지 않는다. 2026-10-10 사용자 선택에 따라 홈 제목과 헤더를 위의 화면 위계대로 변경했다.

## 검증

회귀 근거는 `lib/__tests__/service-home.test.ts`, `service-home-entry.test.js`, `session-landing.test.ts`, `login-navigation.test.js`, `components/service-home/__tests__/ServiceHomeScreen.test.tsx`, `components/__tests__/ServiceHub.test.tsx`와 기존 identity/logout/notification suite다. 로컬 앱 화면과 bundle 증거는 `.codex/harness/service-home-20261009/qa-report.md`에서 관리한다. 실제 계정 로그인·기기 설치·배포 증거와 구분한다.
