# 반도체 패키징용 폴리이미드 동향 수집기

반도체 패키징용 폴리이미드(PSPI, 저유전, 저CTE, RDL/Fan-out, 하이브리드 본딩 등)에 관한
최신 뉴스·논문·프리프린트를 매일 자동으로 모아 웹 페이지와 마크다운 다이제스트로 정리합니다.

- 웹 뷰어: https://gorafaduck.github.io/tools/polyimide/
- 다이제스트: [`digest.md`](digest.md) (최근 7일 신규 항목)

## 구성

| 파일 | 역할 |
| --- | --- |
| `collect.py` | 수집기 (Python 3 표준 라이브러리만 사용) |
| `config.json` | 검색어, 관련도 필터 용어, 주제 태그 규칙 |
| `data.json` | 수집 결과 (뷰어가 읽음, 기본 365일 보관) |
| `digest.md` | 최근 7일 신규 항목 요약 |
| `index.html`, `app.js`, `viewer.css` | 검색·필터·CSV/BibTeX 내보내기가 되는 웹 뷰어 |
| `../.github/workflows/polyimide-digest.yml` | 매일 06:17(KST) 자동 수집 후 커밋 |

## 수집 소스

- **뉴스**: Google News RSS (한국어·영어 검색어 각각)
- **논문**: OpenAlex, Crossref (최근 게재일 기준)
- **프리프린트**: arXiv

## 필터·태그 규칙

1. 제목·초록에 폴리이미드 계열 핵심어(`core_terms`)가 있어야 합니다.
2. 패키징 직접 용어(`context_terms.strong`, 예: RDL, PSPI, low-k) 2점, 보조 용어(`weak`, 예: dielectric, substrate) 1점, 제목의 다른 분야 용어(`exclude_terms`, 예: battery, sensor, colorless) -3점으로 계산해 논문은 2점 이상만 남깁니다.
   기체분리막·배터리 등 다른 분야의 폴리이미드 논문을 걸러내기 위한 조건입니다.
3. `tags`의 규칙에 따라 주제 태그(PSPI, 저유전, 저CTE, 저온경화, 하이브리드 본딩, HBM·칩렛, WSS·임시본딩, 투과도, 고내열성 등)를 붙입니다. 태그 규칙을 바꾸면 다음 실행 때 기존 항목에도 다시 적용됩니다.
4. DOI 또는 제목으로 중복을 제거합니다 (Crossref·OpenAlex·arXiv 사이의 같은 논문은 하나로 합칩니다).

검색어나 태그를 바꾸려면 `config.json`만 수정하면 됩니다.
`mailto`에 이메일을 넣으면 OpenAlex·Crossref의 우선 처리 풀(polite pool)을 사용합니다.

## 로컬 실행

```bash
python3 polyimide/collect.py                    # config.json 기본값(30일)
python3 polyimide/collect.py --days 90          # 최근 90일
python3 polyimide/collect.py --sources news     # 뉴스만 (news,openalex,crossref,arxiv)
python3 -m http.server -d .                     # http://localhost:8000/polyimide/ 에서 확인
```

## 자동 실행

GitHub Actions의 **Polyimide digest** 워크플로가 매일 실행되어 `data.json`과 `digest.md`를 갱신·커밋합니다.
처음 설정 후에는 Actions 탭에서 `Run workflow`로 한 번 수동 실행하세요 (기간을 90 등으로 넣으면 초기 데이터를 넉넉히 채울 수 있습니다).
모든 소스가 실패하면 기존 데이터를 그대로 유지합니다.
