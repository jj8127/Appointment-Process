# 모두온 브랜드 자산

사용자가 승인한 두 사람을 잇는 주황색 M 심볼과 MODUON 워드마크를 준비해 공통 플랫폼에 적용했다. 보험 업무는 가람in을 유지한다.

| 파일 | 용도 |
| --- | --- |
| moduon-symbol.png | 공통 홈·가입·로그인 헤더, Web favicon |
| moduon-logo-primary.png | 흰 시작 화면의 심볼·MODUON 조합 |
| moduon-logo-horizontal.png | 가로 심볼·MODUON 조합 원본 |
| moduon-app-icon.png | 불투명 흰 배경의 공통/iOS 앱 아이콘 |
| moduon-adaptive-foreground.png | Android 투명 foreground와 동일 실루엣의 themed icon |
| moduon-monochrome.png | Android 알림용 흰 실루엣 |

공통 헤더는 심볼과 한글 모두온을 나란히 표시한다. `ModuonBrand`의 작은 뷰포트가 원본 PNG 투명 여백을 제외하며 파일 픽셀을 다시 처리하지 않는다. 앱 아이콘의 바깥 모서리는 OS가 처리한다. Android foreground는108dp 캔버스의66dp 원형 안전 영역에 주요 픽셀이 들어간다. themed icon은 Android가 같은 foreground의 alpha를 단색으로 표시한다([공식 drawable 예시](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)).

원본 로고3개의 생성 정보는 `logo-generation-prompts.json`, 앱 아이콘의 생성 정보는 `native-generation-prompts.json`, 파일 해시는 `asset-metadata.json`에 보존한다. 모든 이미지 추출·편집은 내장 ImageGen으로 진행했다. 원본 자산 준비물은 `D:/hanhwa/outputs/moduon-brand-20261011/`에 있다.

`app.json`이 표시명·앱 아이콘·시작 화면의 기준이다. package/bundle ID·scheme·slug·EAS project는 유지한다. 이미 설치된 앱의 OS 이름·아이콘은 새 native build가 필요하다. 이번 변경은 로컬 적용이며 스토어/OTA 배포나 설치를 수행하지 않았다.
