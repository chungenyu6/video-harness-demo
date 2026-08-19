#!/usr/bin/env python3
"""Prune live-mode output.

A live run costs ~20 MB, nearly all of it a copy of the source video the tools
place in the workspace. Keeping every ad-hoc question forever fills the disk with
things nobody will look at twice, but deleting them the moment they finish throws
away the record while the answer is still on screen - and the whole argument of
this project is that a run's record is what makes it checkable.

So: keep the most recent N, drop the rest. The bundle (~250 KB) is what the
viewer replays; the run directory is the provenance behind it, and both go
together, because a bundle whose run directory is gone can no longer be
re-verified.

Usage:
  python tools/prune_live.py            # keep 10, report what it would remove
  python tools/prune_live.py --apply    # actually remove
  python tools/prune_live.py --keep 3 --apply
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLES = ROOT / "bundles"
RUNS = Path("/home/video-code-harness/video-agent-harness-phase0"
            "/experiments/phase0-video-harness/runs")
MARKER = "-live-"


def size_of(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", type=int, default=10, help="how many recent live runs to keep")
    ap.add_argument("--apply", action="store_true", help="delete; without this, only report")
    args = ap.parse_args()

    bundles = sorted((d for d in BUNDLES.glob(f"*{MARKER}*") if d.is_dir()),
                     key=lambda d: d.stat().st_mtime, reverse=True)
    runs = sorted((d for d in RUNS.glob(f"*{MARKER}*") if d.is_dir()),
                  key=lambda d: d.stat().st_mtime, reverse=True)

    doomed = [*bundles[args.keep:], *runs[args.keep:]]
    if not doomed:
        print(f"nothing to prune ({len(bundles)} live bundles, {len(runs)} run dirs, "
              f"keeping {args.keep})")
        return 0

    total = 0
    for d in doomed:
        n = size_of(d)
        total += n
        print(f"  {'removing' if args.apply else 'would remove'} {d.name}  ({n // 1024 // 1024} MB)")
        if args.apply:
            shutil.rmtree(d, ignore_errors=True)

    print(f"\n{len(doomed)} director{'y' if len(doomed) == 1 else 'ies'}, "
          f"{total // 1024 // 1024} MB"
          + ("" if args.apply else "  — re-run with --apply to delete"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
