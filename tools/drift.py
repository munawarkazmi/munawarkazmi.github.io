"""Catch the site drifting away from the repos it makes claims about.

    python tools/drift.py                 report only
    python tools/drift.py --write-sitemap also rewrite the sitemap lastmod dates

The site's whole argument is that its numbers are checked and re-derived rather
than asserted. That argument is only as good as the day it was last true. The
confusion-matrix card sat on the homepage for two days describing two models
after the benchmark had moved to three, and nothing noticed; it surfaced by
accident. This is the thing that would have noticed.

Three checks, none of which needs a figure to be re-rendered:

  CLAIMS      every number the site states must still equal what the repo it
              came from now records. Checked in both directions: the number
              must also still be on the page, so the manifest cannot quietly
              describe a site that has moved on.

              This used to ask only whether the number was still findable
              somewhere in the repo's prose, and that is much weaker than it
              sounds. A narrowest certified gap of 0.0065 stayed green here
              for days after legibility-bounds had moved to 0.0064, because
              one unrelated file in that repository still contained the old
              string. The check went red only once a human fixed that file,
              which is precisely backwards. Where a repository publishes
              records, the figure is now read out of them and compared. Where
              it does not, the grep remains and is reported as `weak` rather
              than as `ok`, so this tool does not overstate what it knows.

  FIGURES     a figure is stale when the generator or the data behind it has a
              newer commit than the copy committed here. This is exactly the
              signal the confusion card gave: site copy 2 August, generator
              4 August.

              Know what this does not prove. It compares commit dates, so it
              answers "has the upstream moved since we last touched this?" and
              not "does this image show what the repo now produces". Touching a
              figure for a cosmetic reason turns it green without regenerating
              anything. Treat a green here as "no reason to look", not as
              proof the picture is current; when it goes red, re-render from
              the repo rather than re-saving the file.

  SITEMAP     every <lastmod> must equal the page's last commit date.

  DASHES      no en dash or em dash in any tracked text file, as a
              character or as an HTML entity. Banned throughout this
              project, and every route in is a quiet one.

Exit status is 1 if anything drifted, so it can gate a commit.

The sibling repos are expected next to this one. When one is missing the check
is reported as skipped rather than passed, because a check that silently does
nothing is worse than no check.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
REPOS = SITE.parent

# --- reading a repository's own records ----------------------------------

def _json(repo: Path, rel: str):
    return json.loads((repo / rel).read_text(encoding="utf-8"))


def _text(repo: Path, rel: str) -> str:
    return (repo / rel).read_text(encoding="utf-8", errors="ignore")


def _suite(repo: Path) -> list[dict]:
    return _json(repo, "results/suite_bounds.json")["rows"]


def _witness_wins(repo: Path) -> str:
    rows = _suite(repo)
    won = [
        r for r in rows
        if r["witness_achieved"] is not None
        and r["witness_achieved"] > r["search_achieved"]
    ]
    return f"{len(won)} of {len(rows)}"


def _witness_margin(repo: Path) -> float:
    rows = _suite(repo)
    return max(
        r["witness_achieved"] - r["search_achieved"] for r in rows
        if r["witness_achieved"] is not None
        and r["witness_achieved"] > r["search_achieved"]
    )


def _predicate_cases(repo: Path) -> int:
    """The adversarial corpus, summed from its own component counts.

    The summary states the four corpora separately and never states the total,
    so grepping the total only ever confirmed that some prose file still
    repeated it. Summing is what notices a corpus changing size.
    """
    line = next(
        l for l in _text(repo, "reports/test_summary.txt").splitlines()
        if "orientation" in l and "incircle" in l
    )
    return sum(int(n) for n in re.findall(r"\b(\d+)\b", line))


# --- what the site says, and where it came from --------------------------
# `shown` must still appear on the page, which catches this manifest going on
# to describe a page that has moved. What catches the number itself going
# stale depends on which of two modes the entry uses.
#
#   value    reads the figure out of the repository's own records and requires
#            the site to show exactly that. This is the mode that works. It
#            notices a number changing, which is the thing that actually
#            happens.
#
#   pattern  greps the repository's prose. It notices a number disappearing
#            and not a number changing, because prose goes stale too: a
#            narrowest gap of 0.0065 stayed green here for as long as one
#            unrelated file in legibility-bounds still contained the string,
#            days after the results said 0.0064. Kept only where a repository
#            publishes no machine-readable record, and reported as `weak`
#            rather than as `ok` so the summary does not overstate itself.
#
# `note` records a derivation where the site aggregates repo figures.
CLAIMS = [
    dict(label="tests and label proofs", site="index.html", shown="548",
         repo="plan-failure-bench", pattern=r"\b548\b"),
    dict(label="instructions", site="index.html", shown=">60<",
         repo="plan-failure-bench", pattern=r"Instructions \| 60\b|\b60, each with a proof"),
    dict(label="complete runs in the grid", site="index.html", shown="eighteen runs",
         repo="plan-failure-bench", pattern=r"grid \| 18\b|\b18, every record"),

    dict(label="narrowest certified gap", site="index.html", shown="0.0064",
         repo="legibility-bounds", fmt="{:.4f}",
         value=lambda r: min(x["bound"] - x["achieved"] for x in _suite(r))),
    dict(label="widest certified gap", site="index.html", shown="0.0567",
         repo="legibility-bounds", fmt="{:.4f}",
         value=lambda r: max(x["bound"] - x["achieved"] for x in _suite(r))),
    dict(label="construction beats local search by", site="index.html", shown="0.1485",
         repo="legibility-bounds", fmt="{:.4f}", value=_witness_margin),
    dict(label="cases where construction wins", site="index.html", shown="13 of 32",
         repo="legibility-bounds", value=_witness_wins),

    dict(label="flawed proposals recovered", site="index.html", shown="38/38",
         repo="llm-nav-shield", pattern=r"recovered_from_unsafe\s+35",
         note="site shows 38 = 35 recovered_from_unsafe + 3 recovered_from_off_goal"),
    dict(label="no-safe-path cases halted", site="index.html", shown="10/10",
         repo="llm-nav-shield", pattern=r"\b10\b"),

    dict(label="adversarial predicate cases", site="index.html", shown="657",
         repo="exact-predicates", value=_predicate_cases,
         note="summed from the four corpora, which is all the summary states"),

    dict(label="schema passes n of 40", site="index.html", shown="39 of 40",
         repo="toolcall-contract", pattern=r"39 ?/ ?40|39 of 40"),

    dict(label="fuzzed replans vs Dijkstra", site="index.html", shown="185,237",
         repo="ros2-dynamic-path-planning", pattern=r"185,?237"),
    dict(label="D* Lite mean speedup", site="index.html", shown="4.3x",
         repo="ros2-dynamic-path-planning", pattern=r"4\.3\s?[x×]"),

    dict(label="unsafe plans caught, both models", site="index.html", shown="35/35 &middot; 32/32",
         repo="ros2-llm-safety-verifier", pattern=r"35 / 0.*32 / 0|unsafe caught"),
    dict(label="constructed verifier cases", site="index.html", shown="2,071",
         repo="ros2-llm-safety-verifier", pattern=r"2,?071"),
]

# --- figures, and the sources that invalidate them -----------------------
FIGURES = [
    # Name the record this chart is actually drawn from rather than the whole
    # results directory. Watching the directory cried stale the moment an
    # unrelated record landed in it, which trains a reader to ignore the
    # signal, and a check nobody believes is worse than no check. The other
    # entries below still watch directories because their dependencies have
    # not been traced.
    ("assets/legibility-bounds-intervals.png", "legibility-bounds",
     ["tools/build_readme_figures.py", "results/suite_bounds.json"]),
    ("projects/img/pfb-confusion.png", "plan-failure-bench",
     ["tools/build_results_figure.py", "results"]),
    ("projects/img/pfb-confusion-office.png", "plan-failure-bench",
     ["tools/build_results_figure.py", "results"]),
    ("projects/img/pfb-confusion-card.png", "plan-failure-bench",
     ["tools/build_results_figure.py", "results"]),
    ("projects/img/hull_breakage.png", "exact-predicates",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/incircle_threshold.png", "exact-predicates",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/vanishing_determinant.png", "exact-predicates",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/shield_halt.png", "llm-nav-shield",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/shield_outcomes.png", "llm-nav-shield",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/shield_recovery.png", "llm-nav-shield",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/toolcall_qwen_layers.png", "toolcall-contract",
     ["tools/render_figures.py", "reports"]),
    ("projects/img/astar_plan.png", "ros2-dynamic-path-planning",
     ["core/tools/render_figures.py", "reports"]),
    ("projects/img/benchmark_summary.png", "ros2-dynamic-path-planning",
     ["core/tools/render_figures.py", "reports"]),
    ("projects/img/replan_obstacle.png", "ros2-dynamic-path-planning",
     ["core/tools/render_figures.py", "reports"]),
    ("projects/img/replan_scatter.png", "ros2-dynamic-path-planning",
     ["core/tools/render_figures.py", "reports"]),
    ("projects/img/qwen_example.png", "ros2-llm-safety-verifier",
     ["core/tools/render_figures.py", "reports"]),
    ("projects/img/qwen_outcomes.png", "ros2-llm-safety-verifier",
     ["core/tools/render_figures.py", "reports"]),
    ("projects/img/verifier_latency.png", "ros2-llm-safety-verifier",
     ["core/tools/render_figures.py", "reports"]),
]

SITEMAP_PAGES = {
    "https://munawarkazmi.com/": "index.html",
}

GREEN, RED, YELLOW, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def git_date(repo: Path, path: str) -> str | None:
    """Last commit date touching `path`, as YYYY-MM-DD."""
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", path],
                             cwd=repo, capture_output=True, text=True, timeout=30)
    except Exception:
        return None
    d = out.stdout.strip()
    return d or None


def repo_prose(repo: Path) -> str:
    """Every markdown file in the repo root and docs/, concatenated."""
    parts = []
    for p in list(repo.glob("*.md")) + list(repo.glob("docs/*.md")):
        try:
            parts.append(p.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            pass
    return "\n".join(parts)


def check_claims() -> tuple[int, int, int]:
    print(f"\n{'CLAIMS':-<74}")
    ok = bad = skipped = 0
    weak = 0
    prose_cache: dict[str, str] = {}
    for c in CLAIMS:
        repo = REPOS / c["repo"]
        page = (SITE / c["site"]).read_text(encoding="utf-8", errors="ignore")
        note = f"  {DIM}({c['note']}){OFF}" if c.get("note") else ""

        if c["shown"] not in page:
            print(f"  {RED}MANIFEST{OFF} {c['label']}: '{c['shown']}' is no longer on "
                  f"{c['site']}. This entry describes a page that has changed.")
            bad += 1
            continue

        if not repo.exists():
            print(f"  {YELLOW}SKIP{OFF}     {c['label']}: {c['repo']} not found beside the site")
            skipped += 1
            continue

        if "value" in c:
            try:
                found = c["value"](repo)
            except (OSError, KeyError, IndexError, ValueError, StopIteration) as exc:
                print(f"  {RED}RECORD{OFF}   {c['label']}: cannot read the figure out of "
                      f"{c['repo']}: {type(exc).__name__}: {exc}. A claim whose record "
                      f"cannot be read is unchecked, not fine.")
                bad += 1
                continue
            rendered = c.get("fmt", "{}").format(found)
            if rendered == c["shown"]:
                print(f"  {GREEN}ok{OFF}       {c['label']}: {c['shown']} matches "
                      f"{c['repo']} records{note}")
                ok += 1
            else:
                print(f"  {RED}DRIFT{OFF}    {c['label']}: the site says {c['shown']}, but "
                      f"{c['repo']} records now give {rendered}")
                bad += 1
            continue

        if c["repo"] not in prose_cache:
            prose_cache[c["repo"]] = repo_prose(repo)
        if re.search(c["pattern"], prose_cache[c["repo"]], re.S):
            print(f"  {YELLOW}weak{OFF}     {c['label']}: {c['shown']} still appears in "
                  f"{c['repo']} prose, which does not mean it is still true{note}")
            ok += 1
            weak += 1
        else:
            print(f"  {RED}DRIFT{OFF}    {c['label']}: the site says {c['shown']}, but "
                  f"/{c['pattern']}/ no longer matches anything in {c['repo']}")
            bad += 1

    if weak:
        print(f"\n  {DIM}{weak} of {len(CLAIMS)} claims are only grepped, because their "
              f"repositories publish no machine-readable record. Those catch a number "
              f"vanishing, not a number changing.{OFF}")
    return ok, bad, skipped


def check_figures() -> tuple[int, int, int]:
    print(f"\n{'FIGURES':-<74}")
    ok = bad = skipped = 0
    for site_rel, repo_name, sources in FIGURES:
        repo = REPOS / repo_name
        if not repo.exists():
            print(f"  {YELLOW}SKIP{OFF}     {site_rel}: {repo_name} not found")
            skipped += 1
            continue
        if not (SITE / site_rel).exists():
            print(f"  {RED}MANIFEST{OFF} {site_rel} is listed here but not in the site")
            bad += 1
            continue

        here = git_date(SITE, site_rel)
        upstream = [(s, git_date(repo, s)) for s in sources]
        newest = max((d for _, d in upstream if d), default=None)
        if not here or not newest:
            print(f"  {YELLOW}SKIP{OFF}     {site_rel}: no commit history to compare")
            skipped += 1
            continue

        if newest > here:
            who = ", ".join(s for s, d in upstream if d == newest)
            print(f"  {RED}STALE{OFF}    {site_rel}: committed {here}, but {who} "
                  f"changed {newest} in {repo_name}")
            bad += 1
        else:
            print(f"  {GREEN}ok{OFF}       {site_rel}: {here} >= upstream {newest}")
            ok += 1
    return ok, bad, skipped


def sitemap_entries() -> list[tuple[str, str | None, str]]:
    """(loc, lastmod-in-file, local page path) for every sitemap URL."""
    text = (SITE / "sitemap.xml").read_text(encoding="utf-8")
    out = []
    for block in re.findall(r"<url>(.*?)</url>", text, re.S):
        loc = re.search(r"<loc>([^<]+)</loc>", block).group(1)
        lm = re.search(r"<lastmod>([^<]+)</lastmod>", block)
        rel = SITEMAP_PAGES.get(loc, loc.replace("https://munawarkazmi.com/", ""))
        out.append((loc, lm.group(1) if lm else None, rel))
    return out


def check_sitemap(write: bool) -> tuple[int, int, int]:
    print(f"\n{'SITEMAP':-<74}")
    ok = bad = 0
    fixes = {}
    for loc, lastmod, rel in sitemap_entries():
        real = git_date(SITE, rel)
        if real is None:
            print(f"  {RED}MISSING{OFF}  {loc} maps to {rel}, which is not in the site")
            bad += 1
            continue
        if lastmod == real:
            print(f"  {GREEN}ok{OFF}       {rel}: {real}")
            ok += 1
        else:
            state = "absent" if lastmod is None else lastmod
            print(f"  {RED}STALE{OFF}    {rel}: sitemap says {state}, git says {real}")
            fixes[loc] = real
            bad += 1

    if write and fixes:
        text = (SITE / "sitemap.xml").read_text(encoding="utf-8")
        for loc, date in fixes.items():
            block = re.search(rf"(<url>\s*<loc>{re.escape(loc)}</loc>)(.*?)(</url>)", text, re.S)
            head, body, tail = block.groups()
            body = re.sub(r"\s*<lastmod>[^<]*</lastmod>", "", body)
            text = text.replace(block.group(0), f"{head}\n    <lastmod>{date}</lastmod>{body}{tail}")
        (SITE / "sitemap.xml").write_text(text, encoding="utf-8")
        print(f"\n  wrote {len(fixes)} lastmod dates into sitemap.xml")
        bad = 0
    return ok, bad, 0


def tracked_text_files(exts) -> list[str]:
    """Paths git is tracking, filtered to text this project actually wrote."""
    try:
        out = subprocess.run(["git", "ls-files"], cwd=SITE,
                             capture_output=True, text=True, timeout=30)
    except Exception:
        return []
    return [line for line in out.stdout.splitlines()
            if Path(line).suffix.lower() in exts]


def check_dashes() -> tuple[int, int, int]:
    """No en dash or em dash anywhere in the site's own text.

    Every way they arrive is quiet. A paste out of a word processor, an
    HTML entity that looks like markup rather than punctuation, or a
    LaTeX "--" that only becomes an en dash once it is typeset. One
    reached a published table that way and was found by reading the
    rendered page, which is not a repeatable way to find anything.

    Only tracked files are read, so a vendored dependency cannot fail
    this for text nobody here wrote.
    """
    print(f"\n{'DASHES':-<74}")
    banned = {
        "en dash": "–",
        "em dash": "—",
        "horizontal bar": "―",
        "&ndash;": "&ndash;",
        "&mdash;": "&mdash;",
        "&#8211;": "&#8211;",
        "&#8212;": "&#8212;",
    }
    exts = {".html", ".md", ".css", ".js", ".json", ".xml", ".txt", ".svg"}
    files = tracked_text_files(exts)
    if not files:
        print(f"  {YELLOW}SKIP{OFF}     no tracked text files found")
        return 0, 0, 1

    ok = bad = 0
    for rel in files:
        try:
            text = (SITE / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        found = {name: text.count(ch) for name, ch in banned.items() if ch in text}
        if found:
            print(f"  {RED}DASH{OFF}     {rel}: "
                  + ", ".join(f"{n} x{c}" for n, c in found.items()))
            bad += 1
        else:
            ok += 1
    if not bad:
        print(f"  {GREEN}ok{OFF}       {ok} tracked text files, no en or em dashes")
    return ok, bad, 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write-sitemap", action="store_true",
                    help="rewrite sitemap.xml's lastmod dates from git")
    args = ap.parse_args()

    results = [check_claims(), check_figures(), check_sitemap(args.write_sitemap),
               check_dashes()]
    ok = sum(r[0] for r in results)
    bad = sum(r[1] for r in results)
    skipped = sum(r[2] for r in results)

    print(f"\n{'':-<74}")
    verdict = f"{RED}{bad} drifted{OFF}" if bad else f"{GREEN}nothing drifted{OFF}"
    print(f"{ok} ok, {verdict}" + (f", {YELLOW}{skipped} skipped{OFF}" if skipped else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
