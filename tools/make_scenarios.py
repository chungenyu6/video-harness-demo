#!/usr/bin/env python3
"""Regenerate the scenario list the viewer's picker is built from.

Swapping content should not require editing code, so this derives everything it
can from the bundles that exist and keeps the parts that need a human in
separate files:

  content/featured.json      hand-written entries, kept verbatim and listed first.
                             Editorial framing - which pairing makes an argument -
                             is not derivable from the data.
  content/video_labels.json  video id -> readable name. Optional; an unknown video
                             falls back to its id rather than failing.

Everything else is generated: one scenario per sample_id, with one run per
harness, ordered benchmark items first.

Usage:
  python tools/make_scenarios.py                      # write app/public/scenarios.json
  python tools/make_scenarios.py --check              # verify it is up to date, write nothing
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLES = ROOT / "bundles"
OUT = ROOT / "app" / "public" / "scenarios.json"
FEATURED = ROOT / "content" / "featured.json"
LABELS = ROOT / "content" / "video_labels.json"

#: Column order. A run whose harness is not listed still appears, after these.
HARNESS_ORDER = ["opencode", "pi"]

BENCHMARK_NOTE = ("A Video-MME benchmark item: it has an answer key, so this run "
                  "could be scored.")
EXTRA_NOTE = ("A question we wrote for the demo. There is no answer key, so "
              "correctness is not evaluated — only whether the agent did what it "
              "says it did.")


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path} is not valid JSON: {exc}")


def sort_key(sample_id: str):
    """Benchmark items (…-1) before extras, then numerically by video."""
    base, _, suffix = sample_id.partition("-")
    try:
        n = int(base)
    except ValueError:
        n = 1 << 30
    return (0 if suffix == "1" else 1, n, suffix)


def build() -> list[dict]:
    if not BUNDLES.is_dir():
        raise SystemExit(f"no bundles directory at {BUNDLES}")

    bundles: dict[str, dict] = {}
    for f in sorted(BUNDLES.glob("*/bundle.json")):
        # Live runs are ad-hoc questions someone typed. They replay locally
        # through the same viewer, but they are not curated content and must
        # never end up in the published picker.
        if "-live-" in f.parent.name:
            continue
        bundles[f.parent.name] = json.loads(f.read_text())
    if not bundles:
        raise SystemExit(f"no bundles under {BUNDLES}; run tools/export_run.py first")

    featured = load_json(FEATURED, [])
    labels = load_json(LABELS, {})

    # Bundles already claimed by a hand-written scenario are not duplicated below.
    claimed = {name for s in featured for name in s.get("bundles", [])}

    by_sample: dict[str, dict[str, str]] = collections.defaultdict(dict)
    for name, b in bundles.items():
        if name in claimed:
            continue
        by_sample[b["sample_id"]][b["harness"]] = name

    generated = []
    for sid in sorted(by_sample, key=sort_key):
        runs = by_sample[sid]
        order = [h for h in HARNESS_ORDER if h in runs]
        order += [h for h in sorted(runs) if h not in HARNESS_ORDER]
        first = bundles[runs[order[0]]]
        vid = first["video"]["id"]
        generated.append({
            "id": sid,
            "label": f"{labels.get(vid, vid)} — {first['task']['question']}",
            "note": BENCHMARK_NOTE if sid.endswith("-1") else EXTRA_NOTE,
            "bundles": [runs[h] for h in order],
        })

    missing = [s["id"] for s in featured
               if any(n not in bundles for n in s.get("bundles", []))]
    if missing:
        print(f"warning: featured scenario(s) reference missing bundles: {missing}",
              file=sys.stderr)

    return featured + generated


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if the file on disk is out of date")
    args = ap.parse_args()

    text = json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is out of date; run tools/make_scenarios.py")
            return 1
        print(f"{OUT} is up to date")
        return 0

    OUT.write_text(text)
    data = json.loads(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data)} scenarios "
          f"({sum(1 for s in data if s['id'] in {x['id'] for x in load_json(FEATURED, [])})} featured)")
    for s in data[:3]:
        print(f"  {s['id']:<12} {s['label'][:58]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
