#!/usr/bin/env python3
"""Live mode - INTERNAL ONLY.

Binds to 127.0.0.1 and is reached through an SSH tunnel (VS Code Remote-SSH
forwards it automatically). It is never exposed to a network, and must not be:
it shells out to scripts that call `runuser`, and D007's own header says the
permission model is not a sandbox - no syscall filtering, no network namespace,
no resource limits.

Design note. The UI is the same React app the public replay site uses; only the
event source differs. While a run is in flight this server re-parses the
harness's log with the same adapter the exporter uses and emits whatever is new.
When the run finishes it runs the ordinary finalize + export path and sends the
finished bundle, so live mode's end state is byte-identical to what a replay
would have shown. Live mode never becomes a second, divergent code path.

Run:
    /home/video-code-harness/video-agent-harness-phase0/.venv/bin/python \
        -m uvicorn live.app:api --host 127.0.0.1 --port 8080
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DEMO = Path(__file__).resolve().parent.parent
PHASE0 = Path("/home/video-code-harness/video-agent-harness-phase0")
VIDEOS = PHASE0 / "data/working/videos"
LOG_DIR = DEMO / "live" / "logs"

sys.path.insert(0, str(DEMO))
sys.path.insert(0, str(DEMO / "live"))
import adapters  # noqa: E402
from sanitize import default_options, sanitize  # noqa: E402

api = FastAPI(title="video-harness-demo live")


# --------------------------------------------------------------------------- #
# one slot
# --------------------------------------------------------------------------- #

@dataclass
class Job:
    token: str
    harness: str
    video_id: str
    question: str
    options: list[str] = field(default_factory=list)
    run_id: str | None = None
    run_dir: Path | None = None
    status: str = "queued"          # queued | running | finished | failed
    error: str | None = None
    started: float = field(default_factory=time.time)


#: One at a time, on purpose. Both model servers run with --max-num-seqs 1, so a
#: second concurrent run would queue inside vLLM and make both sets of timings
#: meaningless - the very numbers this demo displays.
_slot = threading.Lock()
_jobs: dict[str, Job] = {}

RUN_ID_RE = re.compile(r"^run_id\s*:\s*(\S+)", re.M)
RUN_DIR_RE = re.compile(r"^run_dir\s*:\s*(\S+)", re.M)


def _log_question(job: Job, verdict: str) -> None:
    """Every submission is recorded, accepted or not."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / "questions.jsonl").open("a") as f:
        f.write(json.dumps({
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "token": job.token, "harness": job.harness,
            "video_id": job.video_id, "question": job.question,
            "verdict": verdict,
        }, ensure_ascii=False) + "\n")


def _execute(job: Job) -> None:
    with _slot:
        job.status = "running"
        tasks = LOG_DIR / f"task-{job.token}.jsonl"
        tasks.parent.mkdir(parents=True, exist_ok=True)
        sample_id = f"live-{job.token[:8]}"
        tasks.write_text(json.dumps({
            "sample_id": sample_id,
            "video_path": f"data/working/videos/{job.video_id}.mp4",
            "question": job.question,
            "options": job.options or default_options(),
            "duration": "live",
            "role": "live",
        }, ensure_ascii=False) + "\n")

        env = dict(os.environ)
        env["PHASE0_TASKS_FILE"] = str(tasks)
        env["PHASE0_RUN_TIMEOUT"] = env.get("PHASE0_RUN_TIMEOUT", "300")

        cmd = ["bash", "-lc",
               f"cd {PHASE0} && source scripts/env.sh && "
               f"bash scripts/run_{job.harness}.sh {sample_id} 0"]
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
        out = proc.stdout + proc.stderr

        m_id, m_dir = RUN_ID_RE.search(out), RUN_DIR_RE.search(out)
        if m_dir:
            job.run_id, job.run_dir = (m_id.group(1) if m_id else None), Path(m_dir.group(1))
        if proc.returncode != 0 and not job.run_dir:
            job.status, job.error = "failed", out[-800:]
            return

        # Same finalize + export path as a batch run: live must not produce a
        # different kind of record from the one the public site replays.
        try:
            subprocess.run(
                [sys.executable, "tools/export_run.py", "--force",
                 "--out", str(DEMO / "bundles"), "--run-dir", str(job.run_dir)],
                cwd=DEMO, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            job.status, job.error = "failed", (exc.stderr or "")[-800:]
            return
        job.status = "finished"


# --------------------------------------------------------------------------- #
# api
# --------------------------------------------------------------------------- #

class RunRequest(BaseModel):
    harness: str
    video_id: str
    question: str
    #: sample_id of a suggested question. When set, the server looks the item up
    #: in the task file and uses ITS question and options verbatim. The client
    #: never sends option text: accepting arbitrary options would open a second
    #: channel into the agent's prompt alongside the free-text question, and that
    #: one would not be sanitised.
    sample_ref: str | None = None


TASKS = DEMO / "content" / "demo_tasks.jsonl"


def lookup_sample(sample_id: str) -> dict | None:
    if not TASKS.exists():
        return None
    for line in TASKS.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("sample_id") == sample_id:
            return row
    return None


@api.get("/api/videos")
def videos() -> list[dict]:
    inv = json.loads((PHASE0 / "data/working/video_inventory.json").read_text())
    return [{"id": Path(k).stem, "duration_sec": v.get("duration_sec")}
            for k, v in sorted(inv.get("videos", {}).items())]


@api.get("/api/status")
def status() -> dict:
    return {"busy": _slot.locked(),
            "jobs": {t: j.status for t, j in _jobs.items()}}


@api.post("/api/run")
def start(req: RunRequest) -> dict:
    if req.harness not in adapters.known():
        raise HTTPException(400, f"unknown harness; known: {adapters.known()}")
    if not (VIDEOS / f"{req.video_id}.mp4").exists():
        raise HTTPException(400, "unknown video")

    job = Job(token=uuid.uuid4().hex, harness=req.harness,
              video_id=req.video_id, question=req.question)

    if req.sample_ref:
        row = lookup_sample(req.sample_ref)
        if not row:
            raise HTTPException(400, f"unknown sample_ref {req.sample_ref!r}")
        # Our own content, so it needs no sanitising - and it keeps its real
        # options, which the generic yes/no set would have thrown away.
        job.question = row["question"]
        job.options = list(row.get("options") or [])
        _log_question(job, f"accepted (suggested: {req.sample_ref})")
    else:
        verdict = sanitize(req.question)
        if not verdict.ok:
            _log_question(job, f"rejected: {verdict.reason}")
            raise HTTPException(400, f"question rejected: {verdict.reason}")
        job.question = verdict.question
        _log_question(job, "accepted")
    if _slot.locked():
        raise HTTPException(409, "a run is already in progress; one at a time")

    _jobs[job.token] = job
    threading.Thread(target=_execute, args=(job,), daemon=True).start()
    return {"token": job.token}


@api.get("/api/events/{token}")
async def events(token: str) -> StreamingResponse:
    job = _jobs.get(token)
    if not job:
        raise HTTPException(404, "unknown token")

    async def stream():
        sent = 0
        adapter = adapters.get(job.harness)
        while True:
            if job.run_dir and job.run_dir.exists():
                try:
                    evs = adapter.agent_events(job.run_dir)
                except SystemExit:
                    evs = []
                if evs:
                    t0 = evs[0]["_ts"]
                    for e in evs[sent:]:
                        item = {k: v for k, v in e.items() if k != "_ts"}
                        item["t"] = round(e["_ts"] - t0, 3)
                        yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                    sent = len(evs)

            if job.status in ("finished", "failed"):
                if job.status == "finished":
                    name = (job.run_id or "").rsplit("-", 1)[0]
                    bundle = DEMO / "bundles" / name / "bundle.json"
                    if bundle.exists():
                        yield ("event: bundle\ndata: " +
                               json.dumps({"name": name}) + "\n\n")
                else:
                    yield ("event: error\ndata: " +
                           json.dumps({"error": job.error or "run failed"}) + "\n\n")
                yield "event: done\ndata: {}\n\n"
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# Serve the built viewer last so /api/* wins.
_dist = DEMO / "app" / "dist"
if _dist.exists():
    api.mount("/", StaticFiles(directory=str(_dist), html=True), name="app")
