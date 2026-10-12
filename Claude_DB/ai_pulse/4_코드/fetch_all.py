"""AI Pulse — AI 붐을 숫자와 발언으로 재는 수집 스크립트.

  gurus  : AI 구루 발언 — 뉴스 헤드라인(영문·한글), 본인 블로그·에세이, 블루스카이, 팟캐스트·뉴스레터
  sdk    : 개발자 선택 — PyPI(최근 180일)·npm(최근 1년) AI SDK 일간 다운로드
  jobs   : AI 기업 채용 공고 (Greenhouse·Ashby 공개 API) — 실행마다 스냅샷 누적
  hf     : Hugging Face 모델 다운로드 상위 1,000개·트렌딩 — 스냅샷 누적
  apps   : 앱스토어 무료 순위 (한국·미국) — 스냅샷 누적
  github : 주요 AI 오픈소스 저장소 스타 — 스냅샷 누적
  arxiv  : arXiv AI 분야 월별 논문 수

사용법 (프로젝트 폴더에서):
    python3 4_코드/fetch_all.py
    python3 4_코드/fetch_all.py --only gurus jobs
필요 패키지: pandas
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import html
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "1_원본데이터"
OUT = ROOT / "2_결과물" / "data"
# SEC asks for a contact address in the User-Agent. Keep it out of the code (this folder is shared publicly):
# put SAVVY_UA="SavvyETF research you@example.com" in ai_pulse/.env.local (not committed) — daily.sh loads it.
UA = os.environ.get("SAVVY_UA", "SavvyETF research (https://github.com/parkwooyeol9/SavvyETF)")
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
NOW = dt.datetime.now(dt.timezone.utc)
STAMP = dt.datetime.now().strftime("%Y-%m-%d")
try:  # Anaconda's bundled CA list can be too old for some sites
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = None

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def fetch(url: str, *, ua: str = UA, retries: int = 3, timeout: int = 60, wait: float = 3) -> bytes:
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise
            log(f"  HTTP {e.code} ({attempt}/{retries}): {url[:90]}")
            time.sleep(wait * attempt * (4 if e.code == 429 else 1))
        except Exception as e:  # noqa: BLE001
            log(f"  오류 ({attempt}/{retries}): {e}")
            time.sleep(wait * attempt)
    raise RuntimeError(f"다운로드 실패: {url}")


def get_json(url: str, **kw):
    return json.loads(fetch(url, **kw).decode("utf-8-sig"))


def save(df: pd.DataFrame, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / name, index=False, encoding="utf-8")
    log(f"  저장: 2_결과물/data/{name} ({len(df):,} 행)")


def append_history(df: pd.DataFrame, name: str, keys: list[str], keep: str = "last") -> pd.DataFrame:
    """Snapshot sources only expose 'now'; keep every run so trends build up over time.
    keep="first" preserves the first-seen row (used for headlines, so 'seen' = first day we saw it)."""
    p = OUT / name
    if p.exists():
        df = pd.concat([pd.read_csv(p, dtype=str), df.astype(str)], ignore_index=True).drop_duplicates(keys, keep=keep)
    save(df, name)
    return df


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def parse_date(s: str) -> str:
    if not s:
        return ""
    try:
        return email.utils.parsedate_to_datetime(s).date().isoformat()
    except (TypeError, ValueError):
        return s[:10]


def rss_items(xml: bytes) -> list[dict]:
    """Minimal RSS/Atom reader → [{title, link, date, summary}]."""
    root = ET.fromstring(xml)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    for it in root.iter("item"):
        out.append({"title": strip_tags(it.findtext("title")), "link": it.findtext("link") or "",
                    "date": parse_date(it.findtext("pubDate")), "summary": strip_tags(it.findtext("description"))[:300],
                    "source": strip_tags(it.findtext("source") or "")})
    for it in root.iterfind("a:entry", ns):
        link = it.find("a:link", ns)
        out.append({"title": strip_tags(it.findtext("a:title", namespaces=ns)), "link": link.get("href") if link is not None else "",
                    "date": (it.findtext("a:published", namespaces=ns) or it.findtext("a:updated", namespaces=ns) or "")[:10],
                    "summary": strip_tags(it.findtext("a:summary", namespaces=ns) or it.findtext("a:content", namespaces=ns))[:300],
                    "source": ""})
    return out


STATUS: dict[str, dict] = {}


def status(key: str, **kw) -> None:
    STATUS[key] = {**kw, "updated": dt.datetime.now().isoformat(timespec="seconds")}


# ---------------------------------------------------------------------------
# 1. AI 구루 발언
# ---------------------------------------------------------------------------
GURUS = [  # (name, Korean name, role, surname used to confirm a headline is about them)
    ("Ilya Sutskever", "일리야 수츠케버", "SSI 공동창업자 · 전 OpenAI 수석과학자", "Sutskever"),
    ("Sam Altman", "샘 올트먼", "OpenAI CEO", "Altman"),
    ("Dario Amodei", "다리오 아모데이", "Anthropic CEO", "Amodei"),
    ("Demis Hassabis", "데미스 허사비스", "Google DeepMind CEO", "Hassabis"),
    ("Geoffrey Hinton", "제프리 힌턴", "딥러닝 대부 · 노벨물리학상", "Hinton"),
    ("Yann LeCun", "얀 르쿤", "AMI Labs · 전 Meta 수석 AI 과학자", "LeCun"),
    ("Andrej Karpathy", "안드레이 카르파시", "Eureka Labs · 전 Tesla AI 총괄", "Karpathy"),
    ("Jensen Huang", "젠슨 황", "NVIDIA CEO", "Huang"),
    ("Fei-Fei Li", "페이페이 리", "World Labs · 스탠퍼드", "Fei-Fei"),
    ("Andrew Ng", "앤드루 응", "DeepLearning.AI", "Ng"),
    ("Yoshua Bengio", "요슈아 벤지오", "LawZero · 몬트리올대", "Bengio"),
    ("Mustafa Suleyman", "무스타파 술레이만", "Microsoft AI CEO", "Suleyman"),
]
GNEWS = "https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={gl}:{lang}"
SAY = re.compile(r"\b(says?|said|warns?|predicts?|believes?|argues?|thinks?|claims?|calls?|admits?|reveals?|explains?|tells?|"
                 r"urges?|insists?|declares?|suggests?|expects?|slams?|dismisses?|responds?|on why|interview)\b", re.I)
SAY_KO = re.compile(r"(밝혔|말했|강조|경고|전망|예측|주장|언급|발언|지적|평가|답했|설명|촉구|역설|조언|인터뷰|대담|강연)")
# Quoted spans: double/curly quotes anywhere; straight single quotes only at word boundaries (not "doesn't")
QUOTE = re.compile(r"[“\"]([^”\"]{8,240})[”\"]|‘([^’]{8,240})’|(?<![A-Za-z])'([^']{8,240})'(?![A-Za-z])")
NICK = re.compile(r"godfather|father of|pioneer|대부|아버지|창시자", re.I)
# Headlines about the person's private life or the 'Artificial' biopic rather than what they said about AI
NOISE = re.compile(r"garfield|biopic|yura borisov|\bfilm\b|movie|son-in-law|daughter|영화|사위|딸|아들|패션|가죽재킷|깐부", re.I)


def _quote(title: str, after: str | None = None) -> str:
    """Best quoted span in a headline; skips nicknames like 'Godfather of AI'. `after` = prefer a quote right after this name."""
    spans = []
    for m in QUOTE.finditer(title):
        q = next(g for g in m.groups() if g).strip()
        if NICK.search(q) or len(q.split()) < (2 if re.search(r"[가-힣]", q) else 4):
            continue
        near = after is not None and title.rfind(after, 0, m.start()) >= 0 and m.start() - title.rfind(after, 0, m.start()) <= len(after) + 3
        spans.append((not near, -len(q), q))
    return min(spans)[2] if spans else ""
# Topic tags: keyword → tag (lower-case match on title + summary)
TOPICS = {"AGI·초지능": r"\bagi\b|superintelligen|초지능|범용인공지능|일반인공지능", "안전·위험": r"safety|risk|danger|extinction|existential|doom|alignment|안전|위험|멸종|경고",
          "스케일링·연구": r"scaling|pretrain|reasoning|research|benchmark|model|스케일링|추론|연구",
          "버블·투자": r"bubble|valuation|invest|capex|funding|billion|trillion|버블|투자|거품|밸류",
          "일자리": r"\bjobs?\b|employment|labor|workers|unemploy|일자리|고용|실업", "칩·인프라": r"chip|gpu|data ?cent|compute|power|energy|반도체|칩|데이터센터|전력",
          "중국·지정학": r"china|chinese|export control|deepseek|중국|수출통제|딥시크", "규제·정책": r"regulat|policy|law|congress|government|규제|정책|법안|정부"}
# Their own channels (RSS/Atom unless noted)
OWN = [
    ("Sam Altman", "블로그", "https://blog.samaltman.com/posts.atom"),
    ("Andrej Karpathy", "블로그", "https://karpathy.bearblog.dev/feed/"),
    ("Dario Amodei", "에세이", "html:https://www.darioamodei.com/"),
    ("Yann LeCun", "블루스카이", "bsky:yann-lecun.bsky.social"),
    ("Andrej Karpathy", "블루스카이", "bsky:karpathy.bsky.social"),
]
# Long-form venues where these people show up (podcasts / newsletters)
VENUES = [
    ("Dwarkesh Podcast", "팟캐스트", "https://www.dwarkesh.com/feed"),
    ("Lex Fridman Podcast", "팟캐스트", "https://lexfridman.com/feed/podcast/"),
    ("Import AI (Jack Clark, Anthropic)", "뉴스레터", "https://importai.substack.com/feed"),
    ("One Useful Thing (Ethan Mollick)", "뉴스레터", "https://www.oneusefulthing.org/feed"),
    ("Gary Marcus (회의론)", "뉴스레터", "https://garymarcus.substack.com/feed"),
]


def _topics(text: str) -> str:
    t = text.lower()
    return ",".join(k for k, pat in TOPICS.items() if re.search(pat, t))


def _news(name: str, ko: str, surname: str) -> list[dict]:
    rows = []
    for lang, q, hl, gl, ln in [("en", f'"{name}" when:30d', "en-US", "US", "en"), ("ko", f'"{ko}" when:30d', "ko", "KR", "ko")]:
        try:
            items = rss_items(fetch(GNEWS.format(q=urllib.parse.quote(q), hl=hl, gl=gl, lang=ln), ua=BROWSER_UA))
        except Exception as e:  # noqa: BLE001
            log(f"  {name} 뉴스({lang}) 실패: {e}")
            continue
        for it in items:
            title = re.sub(r"\s+-\s+[^-]+$", "", it["title"])  # drop " - Publisher" suffix
            if lang == "en":
                about = surname.lower() in title.lower()
                q = _quote(title)
                # the speech verb must come after the name ("X says"), not "Andrew Garfield says playing Sam Altman"
                v, pos = SAY.search(title), title.lower().find(surname.lower())
                said = bool(q) or bool(v and pos >= 0 and v.start() > pos)
            else:
                short = ko.replace(" ", "")
                about = ko in title or short in title or ko.split()[-1] in title
                # Korean headlines: the speaker's name sits right before the quote — 얀 르쿤 "…"
                key = ko if ko in title else (short if short in title else ko.split()[-1])
                q = _quote(title, after=key)
                near = bool(re.search(re.escape(key) + r"[은는이가도,:]?\s*[\"“'‘]", title))
                said = near or bool(SAY_KO.search(title))
                if not near:
                    q = q if SAY_KO.search(title) else ""
            noise = bool(NOISE.search(title))  # gossip about the person, not their view on AI
            rows.append({"guru": name, "lang": lang, "date": it["date"], "title": title, "source": it["source"], "link": it["link"],
                         "about": about, "statement": about and said and not noise, "quote": q if not noise else "",
                         "topics": _topics(title)})
        time.sleep(1)
    return rows


def _own(name: str, kind: str, src: str) -> list[dict]:
    if src.startswith("bsky:"):
        j = get_json("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor="
                     f"{src[5:]}&limit=20&filter=posts_no_replies")
        rows = []
        for x in j.get("feed", []):
            if x.get("reason"):  # skip reposts
                continue
            p = x["post"]
            text = p["record"].get("text", "")
            rows.append({"guru": name, "kind": kind, "date": p["record"].get("createdAt", "")[:10], "title": text[:280],
                         "link": f"https://bsky.app/profile/{src[5:]}/post/{p['uri'].split('/')[-1]}", "topics": _topics(text)})
        return rows
    if src.startswith("html:"):  # Dario's site: essay/post links, no dates in the list
        base = src[5:]
        page = fetch(base, ua=BROWSER_UA).decode("utf-8", "ignore")
        rows, seen = [], set()
        for href, text in re.findall(r'<a\s[^>]*href="(/(?:essay|post)/[^"]+)"[^>]*>(.*?)</a>', page, re.S):
            t = strip_tags(text)
            if href in seen or len(t) < 4:
                continue
            seen.add(href)
            rows.append({"guru": name, "kind": kind, "date": "", "title": t[:200], "link": base.rstrip("/") + href, "topics": _topics(t)})
        return rows
    return [{"guru": name, "kind": kind, "date": it["date"], "title": it["title"], "link": it["link"],
             "topics": _topics(it["title"] + " " + it["summary"])} for it in rss_items(fetch(src, ua=BROWSER_UA))[:15]]


def run_gurus() -> None:
    log("1) AI 구루 발언 — 뉴스·본인 채널·팟캐스트")
    news = []
    for name, ko, role, surname in GURUS:
        news += _news(name, ko, surname)
    nd = pd.DataFrame(news).drop_duplicates(["guru", "title"])
    save(nd, "guru_news.csv")
    append_history(nd.assign(seen=STAMP), "guru_news_history.csv", ["guru", "title"], keep="first")
    own = []
    for name, kind, src in OWN:
        try:
            own += _own(name, kind, src)
        except Exception as e:  # noqa: BLE001
            log(f"  {name} {kind} 실패: {e}")
    save(pd.DataFrame(own), "guru_own_posts.csv")
    ven = []
    names = [g[0] for g in GURUS] + [g[3] for g in GURUS if g[3] not in ("Ng", "Huang", "Li")]
    for venue, kind, url in VENUES:
        try:
            for it in rss_items(fetch(url, ua=BROWSER_UA))[:25]:
                text = it["title"] + " " + it["summary"]
                hit = sorted({g[0] for g in GURUS if g[0] in text or (g[3] in it["title"] and len(g[3]) > 3)})
                ven.append({"venue": venue, "kind": kind, "date": it["date"], "title": it["title"], "link": it["link"],
                            "gurus": ",".join(hit), "topics": _topics(text)})
        except Exception as e:  # noqa: BLE001
            log(f"  {venue} 실패: {e}")
    save(pd.DataFrame(ven), "guru_venues.csv")
    pd.DataFrame(GURUS, columns=["guru", "ko", "role", "surname"]).to_csv(OUT / "gurus.csv", index=False)
    status("gurus", ok=True, rows=len(nd) + len(own) + len(ven), first=nd.date.min(), last=nd.date.max(),
           statements=int(nd.statement.sum()), license="헤드라인·링크만 저장 (본문은 각 언론사·저자 저작물)")


# ---------------------------------------------------------------------------
# 2. SDK 다운로드
# ---------------------------------------------------------------------------
PYPI = {"openai": "OpenAI", "anthropic": "Anthropic", "google-genai": "Google Gen AI", "mistralai": "Mistral",
        "langchain": "LangChain", "llama-index": "LlamaIndex", "litellm": "LiteLLM", "mcp": "MCP (Model Context Protocol)",
        "transformers": "HF Transformers", "vllm": "vLLM", "ollama": "Ollama"}
NPM = {"openai": "OpenAI", "@anthropic-ai/sdk": "Anthropic", "@google/genai": "Google Gen AI", "ai": "Vercel AI SDK",
       "@modelcontextprotocol/sdk": "MCP (Model Context Protocol)", "langchain": "LangChain"}


def run_sdk() -> None:
    log("2) AI SDK 다운로드 — PyPI·npm")
    rows = []
    for pkg, lab in PYPI.items():
        try:
            for x in get_json(f"https://pypistats.org/api/packages/{pkg}/overall?mirrors=false")["data"]:
                if x["category"] == "without_mirrors":
                    rows.append({"registry": "PyPI", "package": pkg, "label": lab, "date": x["date"], "downloads": x["downloads"]})
        except Exception as e:  # noqa: BLE001
            log(f"  PyPI {pkg} 실패: {e}")
        time.sleep(1.5)
    for pkg, lab in NPM.items():
        try:
            for x in get_json(f"https://api.npmjs.org/downloads/range/last-year/{urllib.parse.quote(pkg, safe='@')}")["downloads"]:
                rows.append({"registry": "npm", "package": pkg, "label": lab, "date": x["day"], "downloads": x["downloads"]})
        except Exception as e:  # noqa: BLE001
            log(f"  npm {pkg} 실패: {e}")
    d = pd.DataFrame(rows)
    save(d, "sdk_downloads.csv")
    status("sdk", ok=True, rows=len(d), first=d.date.min(), last=d.date.max(), license="PyPI(pypistats)·npm 공개 통계")


# ---------------------------------------------------------------------------
# 3. 채용 공고
# ---------------------------------------------------------------------------
BOARDS = [  # (company, platform, board token)
    ("OpenAI", "ashby", "openai"), ("Anthropic", "greenhouse", "anthropic"), ("xAI", "greenhouse", "xai"),
    ("Perplexity", "ashby", "perplexity"), ("Cohere", "ashby", "cohere"), ("Scale AI", "greenhouse", "scaleai"),
    ("Databricks", "greenhouse", "databricks"), ("CoreWeave", "greenhouse", "coreweave"),
    ("Harvey", "ashby", "harvey"), ("Figure AI", "greenhouse", "figureai"),
]
ROLE = [  # first match wins (on title + department)
    ("연구", r"research|scientist|member of technical staff|\bmts\b|alignment|interpretab"),
    ("엔지니어링", r"security|software|\bit\b|automation engineer|developer|frontend|backend|full[- ]?stack"),  # before infra: "Infrastructure Security Engineer"
    ("영업·고객", r"sales|account|customer|solutions|partnership|go[- ]to[- ]market|gtm|business development|marketing|success|deployment|forward deployed"),
    ("하드웨어·인프라", r"hardware|silicon|chip|asic|datacenter|data center|compute|infrastructure|supercomput|network|facilit|power|mechanical|electrical|robot|actuat|manufactur"),
    ("엔지니어링", r"engineer|developer|software|devops|sre\b|security|design|product manager|technical program"),
    ("정책·안전·운영", r"policy|safety|trust|legal|counsel|compliance|government|public sector|operations|finance|recruit|people|hr\b|communications|workplace|accounting|tax"),
]


def _role(text: str) -> str:
    t = text.lower()
    return next((k for k, pat in ROLE if re.search(pat, t)), "기타")


def run_jobs() -> None:
    log("3) AI 기업 채용 공고")
    rows = []
    for comp, plat, token in BOARDS:
        try:
            if plat == "ashby":
                for j in get_json(f"https://api.ashbyhq.com/posting-api/job-board/{token}")["jobs"]:
                    rows.append({"company": comp, "title": j.get("title", ""), "department": j.get("department") or j.get("team") or "",
                                 "location": j.get("location", ""), "published": (j.get("publishedAt") or "")[:10]})
            else:
                for dep in get_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/departments")["departments"]:
                    for j in dep["jobs"]:
                        rows.append({"company": comp, "title": j.get("title", ""), "department": dep["name"],
                                     "location": (j.get("location") or {}).get("name", ""),
                                     "published": (j.get("first_published") or j.get("updated_at") or "")[:10]})
        except Exception as e:  # noqa: BLE001
            log(f"  {comp} 실패: {e}")
    d = pd.DataFrame(rows).drop_duplicates(["company", "title", "location", "department"])
    d["role"] = (d.title + " " + d.department).map(_role)
    d["snapshot"] = STAMP
    save(d, "jobs_snapshot.csv")
    summ = d.groupby(["snapshot", "company"]).size().rename("open").reset_index()
    append_history(summ, "jobs_history.csv", ["snapshot", "company"])
    status("jobs", ok=True, rows=len(d), first=STAMP, last=STAMP, companies=int(d.company.nunique()),
           license="각 회사 공개 채용 게시판 API")


# ---------------------------------------------------------------------------
# 4. Hugging Face
# ---------------------------------------------------------------------------

def run_hf() -> None:
    log("4) Hugging Face 모델")
    top = get_json("https://huggingface.co/api/models?sort=downloads&direction=-1&limit=1000")
    d = pd.DataFrame([{"model": m["id"], "org": m["id"].split("/")[0] if "/" in m["id"] else m["id"],
                       "downloads_30d": m.get("downloads", 0), "likes": m.get("likes", 0),
                       "pipeline": m.get("pipeline_tag", ""), "created": (m.get("createdAt") or "")[:10]} for m in top])
    d["snapshot"] = STAMP
    save(d, "hf_top_models.csv")
    org = d.groupby(["snapshot", "org"]).downloads_30d.sum().reset_index()
    append_history(org, "hf_org_history.csv", ["snapshot", "org"])
    tr = get_json("https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=30")
    t = pd.DataFrame([{"model": m["id"], "downloads_30d": m.get("downloads", 0), "likes": m.get("likes", 0),
                       "pipeline": m.get("pipeline_tag", ""), "created": (m.get("createdAt") or "")[:10]} for m in tr])
    save(t, "hf_trending.csv")
    status("hf", ok=True, rows=len(d), first=STAMP, last=STAMP, license="Hugging Face 공개 API")


# ---------------------------------------------------------------------------
# 5. 앱스토어 순위
# ---------------------------------------------------------------------------
AI_APPS = {  # label: regex on app name / developer
    "ChatGPT": r"chatgpt", "Claude": r"\bclaude\b", "Gemini": r"\bgemini\b", "Perplexity": r"perplexity", "Grok": r"\bgrok\b",
    "DeepSeek": r"deepseek", "Copilot": r"copilot", "Meta AI": r"meta ai", "Character.AI": r"character\.?ai|character ai",
    "뤼튼(wrtn)": r"뤼튼|wrtn", "Le Chat": r"le chat|mistral", "Sora": r"\bsora\b", "Manus": r"\bmanus\b",
}


def run_apps() -> None:
    log("5) 앱스토어 무료 순위 (한국·미국)")
    rows = []
    for cc in ["kr", "us"]:
        feed = get_json(f"https://rss.applemarketingtools.com/api/v2/{cc}/apps/top-free/100/apps.json")["feed"]["results"]
        for rank, a in enumerate(feed, 1):
            text = f"{a['name']} {a.get('artistName', '')}"
            lab = next((k for k, pat in AI_APPS.items() if re.search(pat, text, re.I)), "")
            rows.append({"snapshot": STAMP, "country": cc.upper(), "rank": rank, "name": a["name"], "developer": a.get("artistName", ""),
                         "ai_app": lab})
    d = pd.DataFrame(rows)
    save(d, "apps_top100.csv")
    append_history(d[d.ai_app != ""], "apps_ai_history.csv", ["snapshot", "country", "ai_app", "name"])
    status("apps", ok=True, rows=len(d), first=STAMP, last=STAMP, ai_in_top100=int((d.ai_app != "").sum()),
           license="Apple 마케팅 RSS")


# ---------------------------------------------------------------------------
# 6. GitHub
# ---------------------------------------------------------------------------
REPOS = ["ollama/ollama", "ggml-org/llama.cpp", "vllm-project/vllm", "sgl-project/sglang", "huggingface/transformers",
         "pytorch/pytorch", "langchain-ai/langchain", "run-llama/llama_index", "modelcontextprotocol/servers",
         "anthropics/claude-code", "openai/codex", "google-gemini/gemini-cli", "comfyanonymous/ComfyUI",
         "deepseek-ai/DeepSeek-V3", "microsoft/autogen", "crewAIInc/crewAI", "openai/openai-agents-python", "unslothai/unsloth"]


def run_github() -> None:
    log("6) GitHub AI 저장소")
    rows = []
    for r in REPOS:
        try:
            j = get_json(f"https://api.github.com/repos/{r}")
            rows.append({"snapshot": STAMP, "repo": j["full_name"], "stars": j["stargazers_count"], "forks": j["forks_count"],
                         "open_issues": j["open_issues_count"], "created": j["created_at"][:10], "pushed": j["pushed_at"][:10],
                         "description": (j.get("description") or "")[:140]})
        except Exception as e:  # noqa: BLE001
            log(f"  {r} 실패: {e}")
    d = pd.DataFrame(rows)
    save(d, "github_repos.csv")
    append_history(d[["snapshot", "repo", "stars"]], "github_history.csv", ["snapshot", "repo"])
    status("github", ok=True, rows=len(d), first=STAMP, last=STAMP, license="GitHub 공개 API")


# ---------------------------------------------------------------------------
# 7. arXiv
# ---------------------------------------------------------------------------
# Monthly listing page ("Total of N entries", new + cross-listed). The query API is often rate-limited (429).
ARXIV = "https://arxiv.org/list/{c}/{m}?skip=0&show=25"
CATS = {"cs.AI": "인공지능", "cs.LG": "머신러닝", "cs.CL": "자연어(LLM)", "cs.RO": "로보틱스"}


def run_arxiv(months: int) -> None:
    log(f"7) arXiv 월별 논문 수 — 최근 {months}개월 (robots.txt crawl-delay 15초 준수, 처음엔 오래 걸림)")
    cache = OUT / "arxiv_monthly.csv"
    have = pd.read_csv(cache, dtype=str) if cache.exists() else pd.DataFrame(columns=["month", "cat", "papers"])
    done = set(zip(have.month, have.cat))
    first = dt.date.today().replace(day=1)
    rows = have.to_dict("records")
    for i in range(months, -1, -1):
        y, m = divmod(first.year * 12 + first.month - 1 - i, 12)
        month = dt.date(y, m + 1, 1).strftime("%Y-%m")
        current = i == 0
        for c in CATS:
            if (month, c) in done and not current:
                continue
            x = fetch(ARXIV.format(c=c, m=month), wait=15).decode("utf-8", "ignore")
            n = re.search(r"Total of ([\d,]+) entries", x)
            rows = [r for r in rows if not (r["month"] == month and r["cat"] == c)]
            rows.append({"month": month, "cat": c, "papers": int(n.group(1).replace(",", "")) if n else None})
            time.sleep(15)
    d = pd.DataFrame(rows).sort_values(["cat", "month"])
    save(d, "arxiv_monthly.csv")
    status("arxiv", ok=True, rows=len(d), first=d.month.min(), last=d.month.max(), license="arXiv API (메타데이터 CC0)")


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    keys = ["gurus", "sdk", "jobs", "hf", "apps", "github", "arxiv"]
    ap.add_argument("--only", nargs="*", choices=keys)
    ap.add_argument("--arxiv-months", type=int, default=24, help="처음 한 번만 오래 걸림(분야×월×15초), 이후엔 이번 달만 갱신")
    a = ap.parse_args()
    sfile = OUT / "status.json"
    if sfile.exists():
        STATUS.update(json.loads(sfile.read_text(encoding="utf-8")))
    jobs = {"gurus": run_gurus, "sdk": run_sdk, "jobs": run_jobs, "hf": run_hf, "apps": run_apps,
            "github": run_github, "arxiv": lambda: run_arxiv(a.arxiv_months)}
    for k in a.only or keys:
        try:
            jobs[k]()
        except Exception as e:  # noqa: BLE001  keep going with the other sources
            log(f"  !! {k} 실패: {e}")
            status(k, ok=False, note=str(e)[:300])
        OUT.mkdir(parents=True, exist_ok=True)
        sfile.write_text(json.dumps(STATUS, ensure_ascii=False, indent=2), encoding="utf-8")
    log("완료. 다음: python3 4_코드/build_dashboard.py")


if __name__ == "__main__":
    main()
