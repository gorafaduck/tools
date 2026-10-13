#!/usr/bin/env python3
"""반도체 패키징용 폴리이미드 뉴스·문헌 수집기.

Google News(한/영), OpenAlex, Crossref, arXiv에서 최근 항목을 모아
관련도 필터·주제 태그를 붙인 뒤 data.json(웹 뷰어용)과 digest.md(요약)를 만든다.
표준 라이브러리만 사용한다.

    python3 polyimide/collect.py                 # config.json 기본값으로 수집
    python3 polyimide/collect.py --days 7        # 최근 7일만
    python3 polyimide/collect.py --sources news  # 뉴스만
"""

import argparse
import datetime as dt
import email.utils
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
USER_AGENT = "polyimide-digest/1.0 (+https://gorafaduck.github.io/tools/polyimide/)"
ALL_SOURCES = ("news", "openalex", "crossref", "arxiv")


def log(msg):
    print(msg, file=sys.stderr)


def fetch(url, timeout=30, retries=2):
    """URL 본문을 문자열로 반환한다. 일시 오류는 재시도한다."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as exc:
            status = getattr(exc, "code", None)
            if attempt == retries or (status and status < 500 and status != 429):
                raise
            time.sleep(2 * (attempt + 1))


# ---------------------------------------------------------------- 텍스트 매칭

class TermMatcher:
    """대소문자 무시 용어 매칭. 영문 용어는 단어 경계를 지키고(짧은 약어는
    뒤쪽 경계도 확인해 'sk'가 'skill'에 걸리지 않게 함) 한글은 부분 일치."""

    def __init__(self, terms):
        self.terms = []
        for term in terms:
            t = term.lower().strip()
            if not t:
                continue
            if re.match(r"[a-z0-9]", t):
                tail = r"(?![a-z])" if len(t) <= 4 else ""
                pattern = r"(?<![a-z0-9])" + re.escape(t) + tail
            else:
                pattern = re.escape(t)
            self.terms.append((term, re.compile(pattern)))

    def hits(self, text):
        text = text.lower()
        return [term for term, rx in self.terms if rx.search(text)]

    def any(self, text):
        text = text.lower()
        return any(rx.search(text) for _, rx in self.terms)


def clean_text(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)  # HTML/JATS 태그 제거
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def norm_title(title):
    return re.sub(r"[^0-9a-z가-힣]+", "", title.lower())[:120]


def truncate(s, n=1200):
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ---------------------------------------------------------------- 소스별 수집

NEWS_LOCALES = {
    "ko": "hl=ko&gl=KR&ceid=KR:ko",
    "en": "hl=en-US&gl=US&ceid=US:en",
}


def collect_news(query, lang, days):
    q = urllib.parse.quote(f"{query} when:{min(days, 30)}d")
    url = f"https://news.google.com/rss/search?q={q}&{NEWS_LOCALES[lang]}"
    root = ET.fromstring(fetch(url))
    items = []
    for it in root.iter("item"):
        title = clean_text(it.findtext("title"))
        outlet = clean_text(it.findtext("source"))
        if outlet and title.endswith(" - " + outlet):
            title = title[: -len(outlet) - 3]
        date = ""
        if it.findtext("pubDate"):
            try:
                date = email.utils.parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
            except (TypeError, ValueError):
                pass
        items.append({
            "type": "news",
            "origin": "Google News",
            "title": title,
            "url": it.findtext("link") or "",
            "source": outlet,
            "date": date,
            "authors": [],
            "abstract": "",
            "doi": "",
            "lang": lang,
            "query": query,
        })
    return items


def openalex_abstract(inv):
    if not inv:
        return ""
    words = {}
    for word, positions in inv.items():
        for p in positions:
            words[p] = word
    return " ".join(words[i] for i in sorted(words))


def collect_openalex(query, since, until, mailto):
    params = {
        "search": query,
        "filter": f"from_publication_date:{since},to_publication_date:{until}",
        "sort": "publication_date:desc",
        "per-page": "50",
    }
    if mailto:
        params["mailto"] = mailto
    data = json.loads(fetch("https://api.openalex.org/works?" + urllib.parse.urlencode(params)))
    items = []
    for w in data.get("results", []):
        loc = w.get("primary_location") or {}
        src = loc.get("source") or {}
        doi = (w.get("doi") or "").replace("https://doi.org/", "")
        items.append({
            "type": "preprint" if w.get("type") == "preprint" else "paper",
            "origin": "OpenAlex",
            "title": clean_text(w.get("display_name") or w.get("title")),
            "url": f"https://doi.org/{doi}" if doi else (loc.get("landing_page_url") or w.get("id", "")),
            "source": src.get("display_name") or "",
            "date": w.get("publication_date") or "",
            "authors": [a["author"]["display_name"] for a in w.get("authorships", [])
                        if a.get("author", {}).get("display_name")],
            "abstract": clean_text(openalex_abstract(w.get("abstract_inverted_index"))),
            "doi": doi.lower(),
            "cited_by": w.get("cited_by_count", 0),
            "lang": "en",
            "query": query,
        })
    return items


def crossref_date(w):
    for key in ("published", "published-online", "published-print", "issued", "created"):
        parts = (w.get(key) or {}).get("date-parts") or [[]]
        p = parts[0]
        if p and p[0]:
            p = list(p) + [1] * (3 - len(p))
            return f"{p[0]:04d}-{p[1]:02d}-{p[2]:02d}"
    return ""


def collect_crossref(query, since, until, mailto):
    params = {
        "query.bibliographic": query,
        "filter": f"from-pub-date:{since},until-pub-date:{until},type:journal-article",
        "sort": "published",
        "order": "desc",
        "rows": "50",
        "select": "DOI,title,author,container-title,published,published-online,"
                  "published-print,issued,created,abstract,URL,type,is-referenced-by-count",
    }
    if mailto:
        params["mailto"] = mailto
    data = json.loads(fetch("https://api.crossref.org/works?" + urllib.parse.urlencode(params)))
    items = []
    for w in data.get("message", {}).get("items", []):
        doi = (w.get("DOI") or "").lower()
        authors = [" ".join(x for x in (a.get("given"), a.get("family")) if x)
                   for a in w.get("author", [])]
        items.append({
            "type": "paper",
            "origin": "Crossref",
            "title": clean_text((w.get("title") or [""])[0]),
            "url": f"https://doi.org/{doi}" if doi else w.get("URL", ""),
            "source": clean_text((w.get("container-title") or [""])[0]),
            "date": crossref_date(w),
            "authors": [a for a in authors if a],
            "abstract": clean_text(w.get("abstract")),
            "doi": doi,
            "cited_by": w.get("is-referenced-by-count", 0),
            "lang": "en",
            "query": query,
        })
    return items


ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


def collect_arxiv(query, since):
    params = {
        "search_query": query,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": "100",
    }
    root = ET.fromstring(fetch("https://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)))
    items = []
    for e in root.findall("a:entry", ATOM):
        date = (e.findtext("a:published", "", ATOM) or "")[:10]
        if date and date < since:
            continue
        link = e.findtext("a:id", "", ATOM)
        for l in e.findall("a:link", ATOM):
            if l.get("rel") == "alternate":
                link = l.get("href")
        doi = (e.findtext("arxiv:doi", "", ATOM) or "").lower()
        items.append({
            "type": "preprint",
            "origin": "arXiv",
            "title": clean_text(e.findtext("a:title", "", ATOM)),
            "url": link,
            "source": "arXiv",
            "date": date,
            "authors": [clean_text(a.findtext("a:name", "", ATOM)) for a in e.findall("a:author", ATOM)],
            "abstract": clean_text(e.findtext("a:summary", "", ATOM)),
            "doi": doi,
            "lang": "en",
            "query": query,
        })
    return items


# ---------------------------------------------------------------- 필터·태그·병합

def annotate(items, cfg):
    """관련 없는 항목을 버리고 태그·점수를 붙인다."""
    core = TermMatcher(cfg["core_terms"])
    strong = TermMatcher(cfg["context_terms"]["strong"])
    weak = TermMatcher(cfg["context_terms"]["weak"])
    exclude = TermMatcher(cfg.get("exclude_terms", []))
    taggers = {name: TermMatcher(terms) for name, terms in cfg["tags"].items()}
    kept = []
    for it in items:
        if not it["title"]:
            continue
        text = f"{it['title']} {it['abstract']}"
        if not core.any(text):
            continue
        # 패키징 직접 용어 2점, 보조 용어 1점, 제목에 다른 분야 용어(배터리·센서 등)가 있으면 -3점
        relevance = 2 * len(strong.hits(text)) + len(weak.hits(text)) - 3 * len(exclude.hits(it["title"]))
        # 논문은 패키징 맥락이 충분해야 함. 뉴스는 다른 분야가 주제인 기사만 제외
        if relevance < (0 if it["type"] == "news" else 2):
            continue
        it["tags"] = [name for name, m in taggers.items() if m.any(text)]
        it["score"] = (3 if core.any(it["title"]) else 0) + relevance + len(it["tags"])
        it["lang"] = "ko" if re.search(r"[가-힣]", it["title"]) else "en"
        it["abstract"] = truncate(it["abstract"])
        it["authors"] = it["authors"][:8]
        kept.append(it)
    return kept


def item_key(it):
    return ("doi:" + it["doi"]) if it.get("doi") else ("t:" + norm_title(it["title"]))


def merge(existing, fresh, today, keep_days):
    """기존 data.json 항목과 합친다. 같은 항목은 더 풍부한 쪽을 남기고 first_seen 유지."""
    by_key = {}
    for it in existing:
        by_key[item_key(it)] = it
    title_index = {norm_title(it["title"]): k for k, it in by_key.items()}

    for it in fresh:
        key = item_key(it)
        # DOI가 있는 항목과 없는 항목(예: arXiv)이 같은 제목이면 동일 취급
        key = key if key in by_key else title_index.get(norm_title(it["title"]), key)
        old = by_key.get(key)
        if old:
            it["first_seen"] = old.get("first_seen", today)
            if len(old.get("abstract", "")) > len(it["abstract"]):
                it["abstract"] = old["abstract"]
            it["score"] = max(it["score"], old.get("score", 0))
        else:
            it["first_seen"] = today
        by_key[key] = it
        title_index[norm_title(it["title"])] = key

    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=keep_days)).isoformat()
    items = [it for it in by_key.values() if (it.get("date") or it["first_seen"]) >= cutoff]
    items.sort(key=lambda it: (it.get("date") or it["first_seen"], it["score"]), reverse=True)
    return items


# ---------------------------------------------------------------- 출력

TYPE_LABEL = {"news": "📰 뉴스", "paper": "📄 논문", "preprint": "🧪 프리프린트"}


def write_digest(path, items, today, window=7):
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=window)).isoformat()
    recent = [it for it in items if it["first_seen"] >= since]
    lines = [
        "# 반도체 패키징용 폴리이미드 동향 다이제스트",
        "",
        f"- 생성일: {today}",
        f"- 최근 {window}일 신규 수집: {len(recent)}건 / 전체 보관: {len(items)}건",
        "- 웹 뷰어: https://gorafaduck.github.io/tools/polyimide/",
        "",
    ]
    tag_count = {}
    for it in recent:
        for t in it["tags"]:
            tag_count[t] = tag_count.get(t, 0) + 1
    if tag_count:
        lines.append("**주제 분포:** " + ", ".join(
            f"{t} {n}" for t, n in sorted(tag_count.items(), key=lambda x: -x[1])))
        lines.append("")
    for typ in ("news", "paper", "preprint"):
        group = sorted((it for it in recent if it["type"] == typ),
                       key=lambda it: (it["score"], it.get("date", "")), reverse=True)
        lines.append(f"## {TYPE_LABEL[typ]} ({len(group)})")
        lines.append("")
        if not group:
            lines.append("_신규 항목 없음_")
        for it in group[:30]:
            meta = " · ".join(x for x in (it.get("date"), it.get("source")) if x)
            tags = " ".join(f"`{t}`" for t in it["tags"])
            lines.append(f"- [{it['title']}]({it['url']}) — {meta} {tags}".rstrip())
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=HERE / "config.json", type=Path)
    ap.add_argument("--out", default=HERE / "data.json", type=Path, help="웹 뷰어용 JSON")
    ap.add_argument("--digest", default=HERE / "digest.md", type=Path, help="마크다운 요약")
    ap.add_argument("--days", type=int, help="수집 기간(일). 기본값은 config의 lookback_days")
    ap.add_argument("--sources", default=",".join(ALL_SOURCES),
                    help="쉼표 구분: " + ",".join(ALL_SOURCES))
    args = ap.parse_args(argv)

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    days = args.days or cfg["lookback_days"]
    today = dt.date.today().isoformat()
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    mailto = cfg.get("mailto", "")
    sources = [s.strip() for s in args.sources.split(",") if s.strip()]

    jobs = []
    if "news" in sources:
        for lang, queries in cfg["news_queries"].items():
            jobs += [(f"news[{lang}] {q}", lambda q=q, lang=lang: collect_news(q, lang, days)) for q in queries]
    if "openalex" in sources:
        jobs += [(f"openalex {q}", lambda q=q: collect_openalex(q, since, today, mailto))
                 for q in cfg["literature_queries"]]
    if "crossref" in sources:
        jobs += [(f"crossref {q}", lambda q=q: collect_crossref(q, since, today, mailto))
                 for q in cfg["literature_queries"]]
    if "arxiv" in sources:
        jobs.append(("arxiv", lambda: collect_arxiv(cfg["arxiv_query"], since)))

    raw, failures = [], 0
    for name, job in jobs:
        try:
            got = job()
            log(f"  ✓ {name}: {len(got)}")
            raw += got
        except Exception as exc:  # 한 소스 실패가 전체를 멈추지 않도록
            failures += 1
            log(f"  ✗ {name}: {exc}")
        time.sleep(1)

    if jobs and failures == len(jobs):
        log("모든 소스 수집 실패 — 기존 데이터를 유지합니다.")
        return 1

    fresh = annotate(raw, cfg)
    existing = []
    if args.out.exists():
        existing = json.loads(args.out.read_text(encoding="utf-8")).get("items", [])
    items = merge(existing, fresh, today, cfg["keep_days"])
    # config.json의 태그 규칙이 바뀌어도 기존 항목에 바로 반영되도록 전체를 다시 태깅
    taggers = {name: TermMatcher(terms) for name, terms in cfg["tags"].items()}
    for it in items:
        text = f"{it['title']} {it.get('abstract', '')}"
        it["tags"] = [name for name, m in taggers.items() if m.any(text)]

    counts = {t: sum(1 for it in items if it["type"] == t) for t in TYPE_LABEL}
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "lookback_days": days,
        "counts": counts,
        "tags": list(cfg["tags"].keys()),
        "items": items,
    }
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_digest(args.digest, items, today)
    log(f"수집 {len(raw)} → 관련 {len(fresh)} → 저장 {len(items)} "
        f"(뉴스 {counts['news']}, 논문 {counts['paper']}, 프리프린트 {counts['preprint']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
