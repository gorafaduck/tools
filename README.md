# 취업 준비 허브 (개인용)

본인만 접근할 수 있는 개인 유틸리티 모음입니다. Cloudflare Pages로 배포하고, Cloudflare Access(이메일 인증 코드 로그인)로 접근을 막습니다.

## 배포·접근 제한 설정 (최초 1회)

### 1. Cloudflare Pages 프로젝트 만들기
1. https://dash.cloudflare.com 에 가입·로그인
2. **Workers & Pages → 만들기(Create) → Pages → Git에 연결(Connect to Git)**
3. GitHub 계정을 연결하고 `gorafaduck/tools` 저장소 선택 (저장소를 비공개로 바꿔도 Cloudflare GitHub 앱에 접근 권한만 있으면 됩니다)
4. 빌드 설정
   - 프로덕션 브랜치: `main`
   - 프레임워크 프리셋: 없음(None)
   - 빌드 명령: 비워 두기
   - 빌드 출력 디렉터리: `/`
5. 배포가 끝나면 `https://<프로젝트명>.pages.dev` 주소가 생깁니다.

### 2. Cloudflare Access로 나만 접근하게 하기
1. Cloudflare 대시보드 → **Zero Trust** (처음이면 팀 이름 지정, Free 플랜 선택)
2. **Access → Applications → Add an application → Self-hosted**
3. 애플리케이션 도메인 2개 추가
   - `<프로젝트명>.pages.dev` (프로덕션)
   - `*.<프로젝트명>.pages.dev` (미리보기 배포·브랜치 주소)
4. 정책(Policy) 추가
   - Action: **Allow**
   - Include → **Emails** → 본인 이메일
5. 로그인 방법(Identity provider)은 기본값 **One-time PIN**(이메일로 코드 수신)이면 충분합니다.
6. 시크릿 창에서 `https://<프로젝트명>.pages.dev` 접속 → 로그인 화면이 뜨고, 본인 이메일로만 들어가지는지 확인

### 3. 기존 공개 사이트 닫기
Cloudflare 주소에서 잘 열리는 것을 확인한 뒤에 진행하세요.
1. GitHub 저장소 → **Settings → Pages** → GitHub Pages 비활성화(Unpublish)
2. GitHub 저장소 → **Settings → General → Danger Zone → Change visibility → Private**
   - 공개 저장소로 두면 사이트를 잠가도 코드와 데이터가 GitHub에서 그대로 보입니다.
   - 폴리이미드 자동 수집(GitHub Actions)은 비공개 저장소에서도 동작합니다. 무료 계정은 월 2,000분 한도이며, 현재 작업은 하루 몇 분 수준입니다.

## 참고
- 모든 페이지에 `noindex`, `robots.txt`(`Disallow: /`), `_headers`(`X-Robots-Tag`)로 검색 엔진 색인을 막아 두었습니다.
- `main`에 커밋이 올라가면(폴리이미드 자동 수집 포함) Cloudflare Pages가 자동으로 다시 배포합니다.
