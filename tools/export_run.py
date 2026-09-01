#!/usr/bin/env python3
"""Export one phase-0 run directory into a self-contained replay bundle.

SECURITY POSTURE — read before editing.

This is an ALLOWLIST exporter. Every file it reads is named in SOURCES below and
every file it copies is matched against COPY_RULES. It never walks a run
directory looking for interesting things, because a run directory is 40+ MB of
agent scratch space containing a copy of the source video, the agent's own git
objects, and whatever else the agent decided to write. A denylist over that is a
promise; an allowlist is a property.

Two further guards, because the bundle gets published:
  * the task record is rebuilt field by field, never copied, so a gold answer
    cannot ride along in a key nobody thought to exclude;
  * assert_no_gold() re-checks the finished bundle before it is written.

Usage:
  python tools/export_run.py --run-dir <run> [--out bundles/] [--force]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import adapters  # noqa: E402
from adapters.base import ev  # noqa: E402

# --- the allowlist ---------------------------------------------------------
# name -> path relative to the run directory. Missing optional files are fine;
# anything not listed here is never opened.
SOURCES = {
    "run":         "run.json",
    "task":        "input/task.json",
    "evidence":    "evidence.json",
    "v0":          "v0_report.json",
    "leak":        "leak_report.json",
    "telemetry":   "telemetry.json",
    "budget_log":  "tool-logs/budget.jsonl",
    "crv_log":     "tool-logs/crv.jsonl",
    "probe_log":   "tool-logs/probe.jsonl",
    "frames_index": "workspace/artifacts_crv/frames_index.json",
}
#: Observation files are numbered AND can live in more than one place. A dense
#: pass writes its frames into whatever directory the agent chose (`win1/` by
#: convention) and vlm_inspect drops the observation beside them - so globbing
#: only artifacts_crv silently loses the second VLM call. That under-reported the
#: agent: the ledger recorded 16 inspected frames while the bundle showed 8, and
#: the dense frames looked as though they had been extracted and never examined.
OBSERVATION_GLOBS = [
    "workspace/artifacts_crv/observation_*.json",
    "workspace/*/observation_*.json",
]

#: Dense passes write their own index. The agent chooses the output directory,
#: and rep_81 pointed extract_window at artifacts_crv - clobbering its own coarse
#: output. So both the canonical location and the collided one must be searched,
#: or a real run becomes unexportable.
WINDOW_GLOBS = ["workspace/artifacts_crv/window.json", "workspace/*/window.json"]

#: The only binaries that may enter a bundle. Three rules because the frames can
#: land in three places: the coarse subdirectory, the artifacts root (dense pass
#: writing over the coarse output), or a separate window directory.
COPY_RULES = [
    ("workspace/artifacts_crv/frames", "*.jpg", "frames"),
    ("workspace/artifacts_crv", "*.jpg", "frames"),
    ("workspace", "win*/*.jpg", "frames"),
]

#: A reference to the answer key itself. If this string survives into a trace,
#: something actually read the file — there is no innocent reason for it.
HARD_FORBIDDEN = ("phase0_gold",)

#: Paths the agent has no business touching, but which legitimately appear in a
#: trace as a REFUSAL. verifier/leak_scan.py makes the same distinction and
#: explains why: "An attempt the kernel refused is evidence the boundary WORKED.
#: Scoring it the same as a successful read would make the flag meaningless."
#: Observed on Pi, which runs a broad `find` and collects EACCES on data/labels.
#: We keep those occurrences, and promote them to a first-class demo signal.
SOFT_FORBIDDEN = ("data/labels", "data/raw", "videomme/test-")

_DENIED_RE = re.compile(r"Permission denied|EACCES|Operation not permitted", re.IGNORECASE)

#: The procedure prompts/phase0_video_qa.md asks for. Fixed, so the UI can draw
#: the road not taken as well as the road taken.
DECLARED_PIPELINE = ["probe_video", "crv_prepare", "vlm_inspect",
                     "extract_window", "vlm_inspect", "submit_evidence"]


def read_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(errors="replace"))
    except json.JSONDecodeError:
        return None


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def basename(p: str | None) -> str | None:
    return Path(p).name if p else None


GOLD_FILE = Path(__file__).resolve().parent.parent / "content" / "gold.json"


def load_gold() -> dict:
    """Answer keys for the benchmark items, kept in the demo repo.

    Deliberately NOT read from phase 0's data/labels - that directory is 0700 and
    must stay unreadable, and reaching into it from here would put the label path
    on the export path. This copy lives beside the demo, is mode 600 on the lab
    machine so the agent user cannot read it either, and is published because
    Video-MME's keys are already public. What phase 0 protects is the agent's
    ignorance during a run, not the secrecy of the answers.
    """
    if not GOLD_FILE.exists():
        return {}
    try:
        return (json.loads(GOLD_FILE.read_text()) or {}).get("gold", {})
    except (json.JSONDecodeError, OSError):
        return {}


def present_gold(original: str | None, mapping: dict | None) -> str | None:
    """Map the key from the original lettering into the lettering the agent saw.

    Options are rotated per run, so the recorded key ("B") is only meaningful
    once translated through this run's presented->original map. Getting this
    backwards would mark correct runs wrong, and it would do so silently.
    """
    if not original:
        return None
    if not mapping:
        return original
    for presented, orig in mapping.items():
        if orig == original:
            return presented
    return None


def build_task(task_raw: dict, run: dict) -> dict:
    """Rebuild the task record field by field. Never copy the source dict."""
    for banned in ("answer", "gold", "label", "correct"):
        if banned in (task_raw or {}):
            raise SystemExit(
                f"REFUSING TO EXPORT: input/task.json contains a {banned!r} field. "
                "A run directory should never hold the answer key."
            )
    gold = present_gold(
        (load_gold().get(run.get("sample_id", "")) or {}).get("answer"),
        run.get("option_presented_to_original"),
    )
    return {
        "question": task_raw.get("question", ""),
        "options": list(task_raw.get("options") or []),
        "option_rotation": run.get("option_rotation"),
        "duration_label": task_raw.get("duration"),
        "has_gold": gold is not None,
        "gold": gold,
    }


def assert_no_gold(bundle: dict) -> list[dict]:
    """Refuse to write a bundle that leaked the answer key.

    Returns the boundary probes found: occurrences of an off-limits path that the
    kernel refused. Those are kept deliberately — they are the isolation working,
    and showing one is a better argument than describing it.
    """
    blob = json.dumps(bundle, ensure_ascii=False)

    for needle in HARD_FORBIDDEN:
        if needle in blob:
            raise SystemExit(
                f"REFUSING TO WRITE: bundle references {needle!r}. "
                "That is the answer key; something upstream actually read it."
            )

    probes: list[dict] = []
    for needle in SOFT_FORBIDDEN:
        start = 0
        while (i := blob.find(needle, start)) != -1:
            start = i + len(needle)
            context = blob[max(0, i - 120): i + 200]
            if not _DENIED_RE.search(context):
                raise SystemExit(
                    f"REFUSING TO WRITE: bundle references {needle!r} without a denial "
                    "in context. An unblocked reference to an off-limits path is a leak."
                )
            probes.append({"path": needle, "blocked": True})
    # One entry per distinct path is enough to tell the story.
    seen, unique = set(), []
    for pr in probes:
        if pr["path"] not in seen:
            seen.add(pr["path"])
            unique.append(pr)
    return unique


def export(run_dir: Path, out_root: Path, force: bool) -> Path:
    src = {k: read_json(run_dir / v) for k, v in SOURCES.items()
           if not v.endswith(".jsonl")}
    src["budget_log"] = read_jsonl(run_dir / SOURCES["budget_log"])
    src["crv_log"] = read_jsonl(run_dir / SOURCES["crv_log"])
    src["probe_log"] = read_jsonl(run_dir / SOURCES["probe_log"])

    run = src["run"]
    if not run:
        raise SystemExit(f"no run.json in {run_dir}")
    harness = run["harness"]
    run_id = run["run_id"]

    # --- harness-specific half -------------------------------------------
    events = adapters.get(harness).agent_events(run_dir)
    if not events:
        raise SystemExit(f"adapter produced no events for {run_id}")

    # --- harness-independent half ----------------------------------------
    # Everything below here is identical for every harness, because the harness
    # only ever ran the same instrumented scripts.
    def results_for(script: str) -> list[float]:
        return [e["_ts"] for e in events
                if e["type"] == "tool.result" and e.get("script") == script]

    # budget.jsonl carries no timestamps, so each reservation is pinned to the
    # completion of the call that made it, matched in order.
    cursors: dict[str, int] = {}
    for row in src["budget_log"]:
        tool = row.get("tool") or ""
        stamps = results_for(tool)
        i = cursors.get(tool, 0)
        ts = stamps[i] if i < len(stamps) else (stamps[-1] if stamps else events[-1]["_ts"])
        cursors[tool] = i + 1
        events.append(ev(ts, "budget.spend",
                         script=tool,
                         detail={"category": row.get("category"), "n": row.get("n"),
                                 "granted": bool(row.get("granted")),
                                 "used_before": row.get("used_before"),
                                 "limit": row.get("limit")}))

    frames_index = src["frames_index"] or {}
    windows = []
    for g in WINDOW_GLOBS:
        for wp in sorted(run_dir.glob(g)):
            w = read_json(wp)
            if w:
                windows.append(w)
    crv_summary = next((r["summary"] for r in src["crv_log"] if "summary" in r), None)
    if frames_index:
        crv_done = results_for("crv_prepare")
        events.append(ev(crv_done[0] if crv_done else events[0]["_ts"], "frames.ready",
                         detail={"count": len(frames_index.get("frames") or []),
                                 "range": frames_index.get("timestamp_range")}))

    obs_paths = []
    for g in OBSERVATION_GLOBS:
        for op in run_dir.glob(g):
            if op not in obs_paths:
                obs_paths.append(op)
    # Coarse first, then window passes, matching the order they were produced.
    obs_paths.sort(key=lambda x: (0 if "artifacts_crv" in str(x.parent) else 1, str(x)))
    observations = [o for o in (read_json(op) for op in obs_paths) if o]
    vlm_done = results_for("vlm_inspect")
    for i, obs in enumerate(observations):
        ts = vlm_done[i] if i < len(vlm_done) else (vlm_done[-1] if vlm_done else events[-1]["_ts"])
        events.append(ev(ts, "observe.done",
                         detail={"window": obs.get("window"),
                                 "frames": len(obs.get("frames_sent") or []),
                                 "summary": obs.get("summary")}))

    evidence = src["evidence"] or {}
    submit_done = results_for("submit_evidence")
    answer_ts = submit_done[-1] if submit_done else events[-1]["_ts"]
    events.append(ev(answer_ts, "answer.submit",
                     detail={"letter": evidence.get("answer"),
                             "items": len(evidence.get("evidence") or [])}))

    v0 = src["v0"] or {}
    end_ts = max(e["_ts"] for e in events)
    events.append(ev(end_ts + 0.5, "verify.result",
                     detail={"v0_status": v0.get("v0_status"),
                             "errors": v0.get("errors") or []}))
    events.append(ev(end_ts + 0.6, "run.end"))

    # --- one clock --------------------------------------------------------
    t0 = min(e["_ts"] for e in events)
    events.sort(key=lambda e: e["_ts"])
    norm = []
    for e in events:
        item = {k: v for k, v in e.items() if k != "_ts"}
        item["t"] = round(e["_ts"] - t0, 3)
        norm.append({"t": item.pop("t"), **item})
    norm.insert(0, {"t": 0.0, "type": "run.start"})

    # --- frames ------------------------------------------------------------
    inspected: set[str] = set()
    obs_by_frame: dict[str, str] = {}
    for obs in observations:
        for f in obs.get("frames_sent") or []:
            n = basename(f.get("frame"))
            if n:
                inspected.add(n)
        for o in obs.get("observations") or []:
            n = basename(o.get("frame"))
            if n:
                obs_by_frame[n] = o.get("observation") or ""

    cited = {basename(item.get("frame")) for item in (evidence.get("evidence") or [])}

    # Coarse frames first, then anything a dense pass added. Keyed by basename so
    # a frame that appears in both indexes is listed once, as coarse.
    sources: list[tuple[str, list]] = [("coarse", frames_index.get("frames") or [])]
    for w in windows:
        sources.append(("dense", w.get("frames") or []))

    frames = []
    seen_names: set[str] = set()
    for pass_name, items in sources:
        for f in items:
            name = basename(f.get("frame"))
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            frames.append({
                "id": Path(name).stem,
                "t": float(f.get("timestamp_sec") or 0.0),
                "file": f"frames/{name}",
                "selection_reason": f.get("selection_reason"),
                "pass": pass_name,
                "inspected": name in inspected,
                "cited": name in cited,
                "observation": obs_by_frame.get(name),
            })

    # An agent may cite a frame that is in neither index - rep_81 cited a stray
    # frame_007.jpg left in the artifacts root. Carry it so the UI can show what
    # was cited rather than silently dropping the citation.
    for name in sorted(n for n in cited if n and n not in seen_names):
        if (run_dir / "workspace" / "artifacts_crv" / name).exists():
            frames.append({
                "id": Path(name).stem, "t": 0.0, "file": f"frames/{name}",
                "selection_reason": "cited but absent from any frame index",
                "pass": "unindexed",
                "inspected": name in inspected, "cited": True,
                "observation": obs_by_frame.get(name),
            })
    frames.sort(key=lambda f: (f["t"], f["id"]))

    # --- pipeline: declared vs actual vs claimed --------------------------
    actual = [e.get("script") for e in norm
              if e["type"] == "tool.call" and e.get("script")]
    claimed = list(evidence.get("tool_trace") or [])

    probe = (src["probe_log"] or [{}])[0]
    telemetry = src["telemetry"] or {}
    leak = src["leak"] or {}

    bundle = {
        "bundle_version": "1.0",
        "run_id": run_id,
        "harness": harness,
        "sample_id": run.get("sample_id", ""),
        "exported_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(timespec="seconds"),
        "source_commit": run.get("git_commit"),
        "task": build_task(src["task"] or {}, run),
        "video": {
            "id": Path(run.get("video_path", "")).stem,
            "duration_sec": float(probe.get("duration_sec") or frames_index.get("duration_sec") or 0),
            "fps": probe.get("fps"),
            "width": probe.get("width"),
            "height": probe.get("height"),
            "nb_frames": probe.get("nb_frames"),
            # Resolved by the app against its public/ root. D3 guarantees the
            # file exists; tools/make_proxies.sh generates it.
            "proxy": f"video/{Path(run.get('video_path', '')).stem}.480p.mp4",
        },
        "budget": {
            "limits": (crv_summary or {}).get("budget", {}).get("limits", run.get("budget", {})),
            "final": (crv_summary or {}).get("budget", {}).get("spent", {}),
            "ledger": [
                {"category": r.get("category"), "n": r.get("n"), "tool": r.get("tool"),
                 "granted": bool(r.get("granted")), "used_before": r.get("used_before"),
                 "limit": r.get("limit"), "detail": None}
                for r in src["budget_log"]
            ],
        },
        "frames": frames,
        "events": norm,
        "pipeline": {
            "declared": DECLARED_PIPELINE,
            "actual": actual,
            "claimed": claimed,
            "agrees": _same_multiset(actual, claimed),
        },
        "answer": {
            "correct": None,   # filled in below once task is built
            "letter": evidence.get("answer"),
            "status": evidence.get("status", "unknown"),
            "frames_processed": evidence.get("frames_processed"),
            "windows_examined": [list(w) for w in (evidence.get("windows_examined") or [])],
            "evidence": [
                {"t": float(i.get("timestamp_sec") or 0), "frame": basename(i.get("frame")) or "",
                 "claim": i.get("claim") or ""}
                for i in (evidence.get("evidence") or [])
            ],
        },
        "verification": {
            "v0_status": v0.get("v0_status", "not_run"),
            "checks": {k: bool(val) for k, val in (v0.get("checks") or {}).items()},
            "errors": list(v0.get("errors") or []),
            "leak_status": leak.get("status"),
            "leak_note": leak.get("note"),
            "does_not_validate": list(v0.get("does_not_validate") or []),
        },
        "telemetry": {
            "wall_clock_sec": telemetry.get("wall_clock_sec"),
            "layers": telemetry.get("layers"),
            "caveats": list(telemetry.get("caveats") or []),
        },
    }
    g = bundle["task"]["gold"]
    bundle["answer"]["correct"] = (bundle["answer"]["letter"] == g) if g else None

    bundle["verification"]["boundary_probes"] = assert_no_gold(bundle)

    # --- write -------------------------------------------------------------
    short = run_id.rsplit("-", 1)[0]
    dest = out_root / short
    if dest.exists():
        if not force:
            raise SystemExit(f"{dest} exists; pass --force to overwrite")
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    (dest / "bundle.json").write_text(
        json.dumps(bundle, indent=1, ensure_ascii=False) + "\n")

    copied = 0
    for rel, pattern, into in COPY_RULES:
        srcdir = run_dir / rel
        if not srcdir.is_dir():
            continue
        (dest / into).mkdir(exist_ok=True)
        for f in sorted(srcdir.glob(pattern)):
            shutil.copy2(f, dest / into / f.name)
            copied += 1

    print(f"{run_id}\n  -> {dest}  ({copied} frames, "
          f"{sum(p.stat().st_size for p in dest.rglob('*') if p.is_file()) // 1024} KB, "
          f"{len(norm)} events)")
    return dest


def _same_multiset(a: list[str], b: list[str]) -> bool:
    from collections import Counter
    return Counter(a) == Counter(b)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", required=True, nargs="+")
    ap.add_argument("--out", default="bundles")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    # One unusable run must not abort a batch. A wedged run leaves a directory
    # with an empty event log; that is a fact about the run, not a reason to stop
    # exporting the thirty that succeeded. Skipped runs are named, not swallowed.
    skipped: list[tuple[str, str]] = []
    done = 0
    for rd in args.run_dir:
        path = Path(rd).resolve()
        try:
            export(path, out_root, args.force)
            done += 1
        except SystemExit as exc:
            msg = str(exc)
            if "REFUSING" in msg:
                raise                      # a leak is never survivable
            skipped.append((path.name, msg))

    if skipped:
        print(f"\nskipped {len(skipped)} run(s):")
        for name, why in skipped:
            print(f"  {name}\n    {why}")
    print(f"\nexported {done}, skipped {len(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
