#!/usr/bin/env python3
"""Gate a replay bundle before it may be committed or published.

Three independent layers, on purpose — the same reasoning phase 0 applies to its
budget ledger, where tools/_budget.py enforces and verifier/v0_validate.py
recomputes. Neither replaces the other.

  1. SCHEMA   the bundle matches schema/bundle.schema.json
  2. LEAK     no answer key; every off-limits path is accompanied by a refusal
  3. SANITY   frames on disk, one monotonic clock, size under budget

Exit code is 0 only if every bundle passes every layer.

Usage:
  python tools/validate_bundle.py bundles/*/          # or bundles/*/bundle.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import jsonschema
except ImportError:
    sys.exit("jsonschema is required: pip install jsonschema")

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schema" / "bundle.schema.json"

HARD_FORBIDDEN = ("phase0_gold",)
SOFT_FORBIDDEN = ("data/labels", "data/raw", "videomme/test-")
DENIED_RE = re.compile(r"Permission denied|EACCES|Operation not permitted", re.IGNORECASE)

MAX_BUNDLE_BYTES = 1_500_000


class Report:
    def __init__(self, name: str):
        self.name = name
        self.fails: list[str] = []
        self.warns: list[str] = []

    def check(self, ok: bool, label: str, detail: str = "") -> None:
        if not ok:
            self.fails.append(f"{label}: {detail}" if detail else label)

    def warn(self, cond: bool, label: str) -> None:
        if cond:
            self.warns.append(label)

    @property
    def ok(self) -> bool:
        return not self.fails


def validate(bundle_dir: Path, schema: dict) -> Report:
    r = Report(bundle_dir.name)
    bj = bundle_dir / "bundle.json"
    if not bj.exists():
        r.check(False, "bundle.json missing", str(bj))
        return r

    try:
        bundle = json.loads(bj.read_text())
    except json.JSONDecodeError as exc:
        r.check(False, "bundle.json is not valid JSON", str(exc))
        return r

    # --- 1. schema ---------------------------------------------------------
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(bundle), key=lambda e: list(e.path))
    for e in errors[:6]:
        loc = "/".join(str(p) for p in e.path) or "(root)"
        r.check(False, "schema", f"{loc}: {e.message}")
    if len(errors) > 6:
        r.check(False, "schema", f"… and {len(errors) - 6} more")

    # --- 2. leak -----------------------------------------------------------
    # boundary_probes is the exporter's own record of refused accesses, so it
    # names off-limits paths by design and carries no surrounding trace text.
    # Scanning it would flag the guard for doing its job; it is validated
    # separately below instead.
    scannable = json.loads(json.dumps(bundle))
    probes = (scannable.get("verification") or {}).pop("boundary_probes", [])
    blob = json.dumps(scannable, ensure_ascii=False)
    for needle in HARD_FORBIDDEN:
        r.check(needle not in blob, "leak", f"answer key reference {needle!r} present")

    for needle in SOFT_FORBIDDEN:
        start = 0
        while (i := blob.find(needle, start)) != -1:
            start = i + len(needle)
            ctx = blob[max(0, i - 120): i + 200]
            r.check(bool(DENIED_RE.search(ctx)), "leak",
                    f"{needle!r} referenced without a refusal in context")

    r.check(bundle.get("task", {}).get("has_gold") is False,
            "leak", "task.has_gold must be false")

    for pr in probes:
        r.check(pr.get("blocked") is True, "leak",
                f"boundary probe for {pr.get('path')!r} is not marked blocked")
    r.warn(bool(probes),
           f"agent probed {len(probes)} off-limits path(s) and was refused — "
           "the isolation boundary was exercised and held")

    # --- 3. sanity ---------------------------------------------------------
    size = sum(p.stat().st_size for p in bundle_dir.rglob("*") if p.is_file())
    r.check(size <= MAX_BUNDLE_BYTES, "size",
            f"{size // 1024} KB exceeds {MAX_BUNDLE_BYTES // 1024} KB")

    missing = [f["file"] for f in bundle.get("frames", [])
               if not (bundle_dir / f["file"]).exists()]
    r.check(not missing, "frames", f"{len(missing)} referenced frame(s) not on disk")

    ts = [e["t"] for e in bundle.get("events", [])]
    r.check(ts == sorted(ts), "clock", "events are not in ascending time order")
    r.check(all(t >= 0 for t in ts), "clock", "negative timestamp present")

    frame_ids = {Path(f["file"]).name for f in bundle.get("frames", [])}
    orphan = [e["frame"] for e in bundle.get("answer", {}).get("evidence", [])
              if e["frame"] and e["frame"] not in frame_ids]
    r.check(not orphan, "evidence", f"cites frame(s) not in this run: {orphan}")

    dur = bundle.get("video", {}).get("duration_sec") or 0
    bad = [w for w in bundle.get("answer", {}).get("windows_examined", [])
           if len(w) == 2 and (w[0] < 0 or w[1] > dur + 0.001)]
    # A window outside the video is a real agent failure (rep_84) and V0 already
    # records it. The bundle must faithfully carry it, so this is informational.
    r.warn(bool(bad), f"agent claimed {len(bad)} window(s) outside the video — "
                      f"faithfully exported, V0 status is {bundle.get('verification', {}).get('v0_status')}")

    inspected = sum(1 for f in bundle.get("frames", []) if f["inspected"])
    claimed = bundle.get("answer", {}).get("frames_processed")
    r.warn(claimed is not None and claimed != inspected,
           f"agent reported {claimed} frames processed, artifacts show {inspected}")

    r.warn(not bundle.get("pipeline", {}).get("agrees", True),
           "claimed tool_trace differs from the ledger-derived actual path")

    r.warn(bundle.get("video", {}).get("proxy") is None,
           "no video proxy yet (generated in D3)")

    return r


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="bundle directories (or their bundle.json)")
    args = ap.parse_args()

    schema = json.loads(SCHEMA.read_text())
    dirs = []
    for p in args.paths:
        path = Path(p)
        dirs.append(path.parent if path.name == "bundle.json" else path)

    reports = [validate(d, schema) for d in sorted(set(dirs))]
    worst = 0
    for rep in reports:
        mark = "PASS" if rep.ok else "FAIL"
        print(f"[{mark}] {rep.name}")
        for f in rep.fails:
            print(f"        ✗ {f}")
            worst = 1
        for w in rep.warns:
            print(f"        · note: {w}")
    n_ok = sum(1 for r in reports if r.ok)
    print(f"\n{n_ok}/{len(reports)} bundles pass")
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
